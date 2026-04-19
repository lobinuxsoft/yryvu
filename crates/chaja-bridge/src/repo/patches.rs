// SPDX-License-Identifier: AGPL-3.0-or-later

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{FixedOffset, TimeZone};

use crate::backend::BackendError;

use super::common::{git2_err, open_git2};

/// Emit a `git format-patch -1 <sha>` equivalent mbox-style `.patch` file.
///
/// The file name follows git's own convention: `0001-<slugified-subject>.patch`.
/// Returns the absolute path of the created file.
pub fn format_patch(repo_path: &Path, sha: &str, out_dir: &Path) -> Result<String, BackendError> {
    let repo = open_git2(repo_path)?;
    let oid = git2::Oid::from_str(sha).map_err(|_| BackendError::CommitNotFound {
        sha: sha.to_string(),
    })?;
    let commit = repo
        .find_commit(oid)
        .map_err(|_| BackendError::CommitNotFound {
            sha: sha.to_string(),
        })?;

    let author = commit.author();
    let author_name = author.name().unwrap_or("").to_string();
    let author_email = author.email().unwrap_or("").to_string();
    let when = author.when();
    let offset = FixedOffset::east_opt(when.offset_minutes() * 60)
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("invalid commit timezone offset")))?;
    let ts = offset
        .timestamp_opt(when.seconds(), 0)
        .single()
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("invalid commit timestamp")))?;
    let date_header = ts.format("%a, %-d %b %Y %H:%M:%S %z").to_string();

    let full_message = commit.message().unwrap_or("");
    let (subject, body) = match full_message.split_once("\n\n") {
        Some((s, b)) => (s.trim().to_string(), b.trim_end().to_string()),
        None => (full_message.trim().to_string(), String::new()),
    };
    let subject_one_line = subject.replace('\n', " ");

    let parent = if commit.parent_count() > 0 {
        Some(commit.parent(0).map_err(git2_err)?)
    } else {
        None
    };
    let old_tree = parent
        .as_ref()
        .map(|p| p.tree())
        .transpose()
        .map_err(git2_err)?;
    let new_tree = commit.tree().map_err(git2_err)?;
    let mut diff_opts = git2::DiffOptions::new();
    let diff = repo
        .diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut diff_opts))
        .map_err(git2_err)?;

    let stats = diff.stats().map_err(git2_err)?;
    let stats_buf = stats
        .to_buf(git2::DiffStatsFormat::FULL, 72)
        .map_err(git2_err)?;
    let stats_text = stats_buf.as_str().unwrap_or("");

    let mut patch_body = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if matches!(origin, 'F' | 'H') {
            patch_body.push_str(&String::from_utf8_lossy(line.content()));
        } else {
            if matches!(origin, '+' | '-' | ' ') {
                patch_body.push(origin);
            }
            patch_body.push_str(&String::from_utf8_lossy(line.content()));
        }
        true
    })
    .map_err(git2_err)?;

    let short_sha: String = sha.chars().take(40).collect();
    let body_block = if body.is_empty() {
        String::new()
    } else {
        format!("\n{body}\n")
    };
    let contents = format!(
        "From {short_sha} Mon Sep 17 00:00:00 2001\n\
From: {author_name} <{author_email}>\n\
Date: {date_header}\n\
Subject: [PATCH] {subject_one_line}\n\
\n\
{body_block}\
---\n\
{stats_text}\n\
{patch_body}\
-- \n\
chaja\n"
    );

    if !out_dir.exists() {
        fs::create_dir_all(out_dir).map_err(|e| {
            BackendError::Git(anyhow::Error::new(e).context("create output directory"))
        })?;
    }

    let file_name = format!("0001-{}.patch", slugify(&subject_one_line));
    let out_path: PathBuf = out_dir.join(file_name);
    fs::write(&out_path, contents)
        .map_err(|e| BackendError::Git(anyhow::Error::new(e).context("write patch file")))?;

    Ok(out_path.display().to_string())
}

/// Match git's own slugifier for `format-patch` output: lowercase ASCII,
/// replace non-alphanumeric runs with `-`, trim to a reasonable length.
fn slugify(subject: &str) -> String {
    let mut out = String::with_capacity(subject.len());
    let mut prev_dash = false;
    for c in subject.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("patch");
    }
    out.chars().take(60).collect()
}
