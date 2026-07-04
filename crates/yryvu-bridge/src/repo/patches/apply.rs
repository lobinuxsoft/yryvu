// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use chrono::DateTime;

use crate::backend::{ApplyPatchOutcome, BackendError};
use crate::repo::common::{git2_err, open_git2};
use crate::undo_log::{record_op_best_effort, OpKind};

/// Apply an mbox `.patch` (git `format-patch` / `git am` input) onto HEAD
/// as a new commit — the inverse of [`super::format_patch`].
///
/// Author identity and date come from the mbox `From:` / `Date:` headers;
/// `committer` is the current user (profile-stamped at the command layer,
/// falling back to the repo signature when `None`). Returns the new commit
/// SHA and the applied subject.
///
/// libgit2's `apply` is atomic: if any hunk fails to land, the call errors
/// and the index + working tree are left untouched. A rejected patch
/// therefore never leaves the repo in a half-applied `git am` state, so
/// there is nothing to abort — unlike a real `git am`, which we cannot
/// drive from libgit2 (yryvu never shells out to `git` in production).
pub fn apply_patch(
    repo_path: &Path,
    patch_path: &Path,
    committer: Option<(&str, &str)>,
) -> Result<ApplyPatchOutcome, BackendError> {
    let repo = open_git2(repo_path)?;

    let raw = std::fs::read(patch_path).map_err(|e| BackendError::PatchParse {
        detail: format!("cannot read patch file: {e}"),
    })?;
    let text = String::from_utf8_lossy(&raw);
    let parsed = parse_mbox(&text)?;

    // `Diff::from_buffer` parses only the unified-diff portion; feed it just
    // the extracted diff body so the mbox headers, the diffstat block, and
    // the signature trailer can't confuse the parser.
    let diff =
        git2::Diff::from_buffer(parsed.diff.as_bytes()).map_err(|_| BackendError::PatchParse {
            detail: "no valid diff found in patch".into(),
        })?;

    // Atomic: either every hunk applies (index + working tree updated) or
    // the repo is left pristine with this error.
    repo.apply(&diff, git2::ApplyLocation::Both, None)
        .map_err(|_| BackendError::PatchDoesNotApply)?;

    // Re-read the index fresh after apply mutated it (mirrors cherry-pick).
    let tree_oid = repo
        .index()
        .map_err(git2_err)?
        .write_tree()
        .map_err(git2_err)?;
    let tree = repo.find_tree(tree_oid).map_err(git2_err)?;
    let head = repo.head().map_err(git2_err)?;
    let parent = head.peel_to_commit().map_err(git2_err)?;

    let author = parsed.author_signature()?;
    let committer_sig = match committer {
        Some((name, email)) => git2::Signature::now(name, email).map_err(git2_err)?,
        None => repo.signature().map_err(git2_err)?,
    };

    let new_oid = repo
        .commit(
            Some("HEAD"),
            &author,
            &committer_sig,
            &parsed.message,
            &tree,
            &[&parent],
        )
        .map_err(git2_err)?;

    // Reachable via HEAD like any commit — the generic Commit op inverts it
    // through `reset --soft HEAD~1` (no bespoke undo variant needed).
    record_op_best_effort(
        repo_path,
        OpKind::Commit {
            sha: new_oid.to_string(),
            parent_sha: Some(parent.id().to_string()),
        },
    );

    Ok(ApplyPatchOutcome {
        new_sha: new_oid.to_string(),
        subject: parsed.subject,
    })
}

/// The pieces the apply side needs out of an mbox patch.
struct ParsedPatch {
    author_name: String,
    author_email: String,
    /// `None` when the `Date:` header is missing or unparseable — the
    /// commit then stamps the author time as "now".
    author_time: Option<git2::Time>,
    /// `Subject:` with the `[PATCH …]` prefix stripped.
    subject: String,
    /// Full commit message: `subject` + `\n\n` + body (body omitted when
    /// empty), inverting `format_patch`'s `\n\n` split.
    message: String,
    /// The unified diff body only (from `diff --git` to the signature).
    diff: String,
}

impl ParsedPatch {
    fn author_signature(&self) -> Result<git2::Signature<'static>, BackendError> {
        let name = if self.author_name.is_empty() {
            "unknown"
        } else {
            &self.author_name
        };
        match self.author_time {
            Some(time) => git2::Signature::new(name, &self.author_email, &time).map_err(git2_err),
            None => git2::Signature::now(name, &self.author_email).map_err(git2_err),
        }
    }
}

/// Parse an mbox patch as produced by `git format-patch` (single patch).
/// Tolerant of real-git output: folded headers, `[PATCH vN M/K]` subject
/// tags, an absent signature trailer, and the extra blank line yryvu's own
/// emitter inserts after `Subject:`.
fn parse_mbox(text: &str) -> Result<ParsedPatch, BackendError> {
    // Header block = everything up to the first blank line; the rest holds
    // the commit body, the `---` separator, the diffstat, and the diff.
    let (header_block, rest) = match text.split_once("\n\n") {
        Some((h, r)) => (h, r),
        None => {
            return Err(BackendError::PatchParse {
                detail: "not an mbox patch (no header/body separator)".into(),
            })
        }
    };

    let unfolded = unfold_headers(header_block);
    let mut from = None;
    let mut date = None;
    let mut subject = None;
    for line in unfolded.lines() {
        if let Some(v) = line.strip_prefix("From:") {
            from = Some(v.trim().to_string());
        } else if let Some(v) = line.strip_prefix("Date:") {
            date = Some(v.trim().to_string());
        } else if let Some(v) = line.strip_prefix("Subject:") {
            subject = Some(v.trim().to_string());
        }
        // The `From <sha> Mon Sep 17 …` mbox separator (no colon) and any
        // other headers are ignored.
    }

    let from = from.ok_or_else(|| BackendError::PatchParse {
        detail: "missing 'From:' header".into(),
    })?;
    let subject_raw = subject.ok_or_else(|| BackendError::PatchParse {
        detail: "missing 'Subject:' header".into(),
    })?;

    let (author_name, author_email) = parse_from(&from)?;
    let author_time = date.as_deref().and_then(parse_date);
    let subject = strip_patch_prefix(&subject_raw);

    // Body runs from the header separator to the `---` separator line.
    let (body_region, diff_region) =
        split_at_separator(rest).ok_or_else(|| BackendError::PatchParse {
            detail: "missing '---' patch separator".into(),
        })?;
    let body = body_region.trim();
    let message = if body.is_empty() {
        subject.clone()
    } else {
        format!("{subject}\n\n{body}")
    };

    let diff = extract_diff(diff_region)?;

    Ok(ParsedPatch {
        author_name,
        author_email,
        author_time,
        subject,
        message,
        diff,
    })
}

/// Collapse RFC-2822 header folding: a line starting with space/tab is a
/// continuation of the previous header.
fn unfold_headers(block: &str) -> String {
    let mut out = String::with_capacity(block.len());
    for line in block.lines() {
        if line.starts_with([' ', '\t']) && !out.is_empty() {
            out.push(' ');
            out.push_str(line.trim_start());
        } else {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(line);
        }
    }
    out
}

/// Split `"Name <email>"` into its parts. Falls back to treating a bare
/// address (`foo@bar`) as the email with no name; errors otherwise.
fn parse_from(from: &str) -> Result<(String, String), BackendError> {
    if let (Some(lt), Some(gt)) = (from.rfind('<'), from.rfind('>')) {
        if lt < gt {
            let name = from[..lt].trim().trim_matches('"').trim().to_string();
            let email = from[lt + 1..gt].trim().to_string();
            return Ok((name, email));
        }
    }
    if from.contains('@') && !from.contains(char::is_whitespace) {
        return Ok((String::new(), from.trim().to_string()));
    }
    Err(BackendError::PatchParse {
        detail: "malformed 'From:' header (expected 'Name <email>')".into(),
    })
}

/// Parse a patch `Date:` header into a git2 time. Tries RFC-2822 first
/// (real-git output), then the exact strftime `format_patch` emits — whose
/// `%-d` day has no leading zero, which strict RFC-2822 rejects.
fn parse_date(date: &str) -> Option<git2::Time> {
    let dt = DateTime::parse_from_rfc2822(date)
        .or_else(|_| DateTime::parse_from_str(date, "%a, %d %b %Y %H:%M:%S %z"))
        .ok()?;
    Some(git2::Time::new(
        dt.timestamp(),
        dt.offset().local_minus_utc() / 60,
    ))
}

/// Strip a leading `[PATCH …]` tag, tolerating `[PATCH v2 3/5]`.
fn strip_patch_prefix(subject: &str) -> String {
    let s = subject.trim();
    if let Some(rest) = s.strip_prefix('[') {
        if let Some(close) = rest.find(']') {
            if rest[..close].to_ascii_uppercase().starts_with("PATCH") {
                return rest[close + 1..].trim().to_string();
            }
        }
    }
    s.to_string()
}

/// Split the post-header text at the bare `---` separator line into
/// `(body, remainder)`. The remainder holds the diffstat + diff + trailer.
fn split_at_separator(rest: &str) -> Option<(&str, &str)> {
    let mut idx = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches('\n') == "---" {
            let body = &rest[..idx];
            let remainder = &rest[idx + line.len()..];
            return Some((body, remainder));
        }
        idx += line.len();
    }
    None
}

/// Pull the unified diff out of the post-separator region: skip the cosmetic
/// diffstat block up to the first `diff --git`, then drop the RFC-3676
/// signature trailer (`\n-- \n…`) that would otherwise corrupt the last hunk.
fn extract_diff(region: &str) -> Result<String, BackendError> {
    let start = region
        .find("diff --git")
        .ok_or_else(|| BackendError::PatchParse {
            detail: "no diff body found".into(),
        })?;
    let mut diff = &region[start..];
    if let Some(sig) = diff.find("\n-- \n") {
        // Keep the newline that terminates the last diff line.
        diff = &diff[..sig + 1];
    }
    Ok(diff.to_string())
}

#[cfg(test)]
mod tests;
