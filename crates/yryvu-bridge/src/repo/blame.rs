// SPDX-License-Identifier: AGPL-3.0-or-later

//! Per-line `git blame` (issue #8).
//!
//! Wraps `git2::Repository::blame_file`. libgit2's blame iterates
//! hunks (line ranges sharing a final commit); we expand into per-line
//! entries so the frontend can render annotations directly without a
//! second pass. Each line carries final commit metadata (sha, author,
//! time, summary) so the blame panel can ship a single payload.

use std::path::Path;

use serde::Serialize;

use crate::backend::BackendError;

use super::common::{git2_err, open_git2, short_sha};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    /// 1-based line number in the blamed revision.
    pub line_no: u32,
    pub sha: String,
    pub short_sha: String,
    pub author_name: String,
    pub author_email: String,
    /// Unix seconds (UTC).
    pub time: i64,
    pub summary: String,
    /// File line content (always rendered inline so blame UI can stand
    /// alone without a parallel file fetch).
    pub content: String,
    /// `true` when the previous line shares the same `sha` — the
    /// frontend uses this to collapse repeated author/date columns
    /// (GK's "first line of a run shows full meta, rest blank").
    pub continues_run: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBlame {
    pub lines: Vec<BlameLine>,
    /// `true` when the file (at the blamed revision) is binary. `lines`
    /// is empty in that case.
    pub is_binary: bool,
    /// File size in bytes for the blamed revision.
    pub size: u64,
}

pub fn file_blame(
    repo_path: &Path,
    path: &str,
    sha: Option<&str>,
) -> Result<FileBlame, BackendError> {
    let repo = open_git2(repo_path)?;

    // Resolve target revision — defaults to HEAD.
    let target_oid = match sha {
        Some(s) => git2::Oid::from_str(s)
            .map_err(|e| BackendError::Git(anyhow::anyhow!("invalid sha '{s}': {e}")))?,
        None => {
            let head = repo.head().map_err(git2_err)?;
            head.peel_to_commit().map_err(git2_err)?.id()
        }
    };
    let commit = repo.find_commit(target_oid).map_err(git2_err)?;
    let tree = commit.tree().map_err(git2_err)?;
    let entry = tree
        .get_path(Path::new(path))
        .map_err(|e| BackendError::Git(anyhow::anyhow!("path '{path}' not in tree: {e}")))?;
    let object = entry.to_object(&repo).map_err(git2_err)?;
    let Some(blob) = object.as_blob() else {
        return Ok(FileBlame {
            lines: Vec::new(),
            is_binary: false,
            size: 0,
        });
    };
    if blob.is_binary() {
        return Ok(FileBlame {
            lines: Vec::new(),
            is_binary: true,
            size: blob.size() as u64,
        });
    }

    let mut opts = git2::BlameOptions::new();
    opts.newest_commit(target_oid)
        .track_copies_same_file(true)
        .track_copies_same_commit_moves(true);

    let blame = repo
        .blame_file(Path::new(path), Some(&mut opts))
        .map_err(git2_err)?;

    let content = String::from_utf8_lossy(blob.content());
    let mut file_lines: Vec<&str> = content.lines().collect();
    // `content.lines()` drops trailing-empty so a final newline is not
    // a phantom blank — matches `git blame` line-count behavior.
    let total_lines = file_lines.len() as u32;

    let mut out: Vec<BlameLine> = Vec::with_capacity(total_lines as usize);
    let mut prev_sha: Option<String> = None;

    for hunk in blame.iter() {
        let final_oid = hunk.final_commit_id();
        let sha = final_oid.to_string();
        let short = short_sha(&final_oid);
        let sig = hunk.final_signature();
        let author_name = sig.name().unwrap_or_default().to_string();
        let author_email = sig.email().unwrap_or_default().to_string();
        let time = sig.when().seconds();
        // Pull summary from the final commit lazily — most blame
        // hunks reuse the same commit so we cache via repo.find_commit
        // hitting libgit2's object cache.
        let summary = repo
            .find_commit(final_oid)
            .ok()
            .and_then(|c| c.summary().map(|s| s.to_string()))
            .unwrap_or_default();

        let start = hunk.final_start_line();
        let count = hunk.lines_in_hunk();
        for offset in 0..count {
            let line_no = (start + offset) as u32;
            // `final_start_line` is 1-based; vector is 0-based.
            let content = file_lines
                .get_mut((line_no - 1) as usize)
                .map(|s| std::mem::take(s).to_string())
                .unwrap_or_default();
            let continues_run = prev_sha.as_deref() == Some(&sha);
            out.push(BlameLine {
                line_no,
                sha: sha.clone(),
                short_sha: short.clone(),
                author_name: author_name.clone(),
                author_email: author_email.clone(),
                time,
                summary: summary.clone(),
                content,
                continues_run,
            });
            prev_sha = Some(sha.clone());
        }
    }

    // Sort by line_no — libgit2 emits hunks in file order but defensively
    // we sort so the frontend can index directly.
    out.sort_by_key(|l| l.line_no);

    Ok(FileBlame {
        lines: out,
        is_binary: false,
        size: blob.size() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(repo)
            .env("GIT_AUTHOR_NAME", "Alice")
            .env("GIT_AUTHOR_EMAIL", "alice@t")
            .env("GIT_COMMITTER_NAME", "Alice")
            .env("GIT_COMMITTER_EMAIL", "alice@t")
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }

    #[test]
    fn blames_three_line_file_to_initial_commit() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        std::fs::write(p.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        git(p, &["add", "a.txt"]);
        git(p, &["commit", "-q", "-m", "initial three lines"]);

        let blame = file_blame(p, "a.txt", None).unwrap();
        assert!(!blame.is_binary);
        assert_eq!(blame.lines.len(), 3);
        assert_eq!(blame.lines[0].content, "one");
        assert_eq!(blame.lines[1].content, "two");
        assert_eq!(blame.lines[2].content, "three");
        let first_sha = &blame.lines[0].sha;
        assert!(blame.lines.iter().all(|l| &l.sha == first_sha));
        // Sample first-line run marker.
        assert!(!blame.lines[0].continues_run);
        assert!(blame.lines[1].continues_run);
    }

    #[test]
    fn blames_modified_line_to_later_commit() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        std::fs::write(p.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        git(p, &["add", "a.txt"]);
        git(p, &["commit", "-q", "-m", "initial"]);
        std::fs::write(p.join("a.txt"), "one\nTWO\nthree\n").unwrap();
        git(p, &["commit", "-aq", "-m", "shout two"]);

        let blame = file_blame(p, "a.txt", None).unwrap();
        assert_eq!(blame.lines.len(), 3);
        assert_eq!(blame.lines[1].content, "TWO");
        assert_ne!(blame.lines[0].sha, blame.lines[1].sha);
        assert_eq!(blame.lines[0].sha, blame.lines[2].sha);
        // Run is broken at line 2 (different sha) and resumes at line 3.
        assert!(!blame.lines[0].continues_run);
        assert!(!blame.lines[1].continues_run);
        assert!(!blame.lines[2].continues_run);
    }

    #[test]
    fn detects_binary_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        std::fs::write(p.join("b.bin"), [0u8, 1, 2, 0, 3]).unwrap();
        git(p, &["add", "b.bin"]);
        git(p, &["commit", "-q", "-m", "add binary"]);

        let blame = file_blame(p, "b.bin", None).unwrap();
        assert!(blame.is_binary);
        assert!(blame.lines.is_empty());
    }
}
