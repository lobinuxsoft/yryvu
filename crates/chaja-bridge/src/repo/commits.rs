// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use anyhow::Context;
use graph_core::{Commit, RefTag};

use crate::backend::{
    BackendError, CommitDiff, DiffHunk, DiffLine, FileDiff, FileStatus, LineKind,
    DIFF_MAX_FILE_BYTES,
};

use super::common::{git2_err, open_git2, open_repo};

pub fn walk_commits(
    repo_path: &Path,
) -> Result<Box<dyn Iterator<Item = Result<Commit, BackendError>> + Send>, BackendError> {
    let repo = open_repo(repo_path)?;

    let head_id = repo
        .head_id()
        .context("resolve HEAD")
        .map_err(BackendError::Revwalk)?;

    let walk = repo
        .rev_walk(Some(head_id))
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ))
        .all()
        .context("start revwalk")
        .map_err(BackendError::Revwalk)?;

    // Collect eagerly for a first cut. Streaming via Tauri events happens at the
    // commands layer — this iterator feeds into the lane assigner synchronously.
    let mut commits = Vec::new();
    for info in walk {
        let info = info.map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;
        let gix_commit = repo
            .find_commit(info.id)
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;

        let author = gix_commit
            .author()
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;
        let time = gix_commit
            .time()
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;
        let message = gix_commit
            .message()
            .map_err(|e| BackendError::Revwalk(anyhow::Error::new(e)))?;

        let parents: Vec<String> = gix_commit.parent_ids().map(|id| id.to_string()).collect();

        let author_line = format!("{} <{}>", author.name, author.email);
        let summary = message.summary().to_string();

        commits.push(Ok(Commit {
            sha: info.id.to_string(),
            parents,
            summary,
            author: author_line,
            author_date: time.seconds,
            refs: Vec::<RefTag>::new(),
        }));
    }

    Ok(Box::new(commits.into_iter()))
}

pub fn commit_diff(repo_path: &Path, sha: &str) -> Result<CommitDiff, BackendError> {
    let repo = open_git2(repo_path)?;
    let oid = git2::Oid::from_str(sha).map_err(git2_err)?;
    let commit = repo.find_commit(oid).map_err(git2_err)?;

    let parent_tree = if commit.parent_count() > 0 {
        Some(
            commit
                .parent(0)
                .map_err(git2_err)?
                .tree()
                .map_err(git2_err)?,
        )
    } else {
        None
    };
    let tree = commit.tree().map_err(git2_err)?;

    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.include_typechange(true).context_lines(3);

    let mut diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut diff_opts))
        .map_err(git2_err)?;

    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true).copies(true);
    diff.find_similar(Some(&mut find_opts)).map_err(git2_err)?;

    let delta_count = diff.deltas().len();
    let mut files = Vec::with_capacity(delta_count);

    for idx in 0..delta_count {
        let delta = diff
            .get_delta(idx)
            .ok_or_else(|| BackendError::Git(anyhow::anyhow!("delta at index {idx} missing")))?;

        let status = match delta.status() {
            git2::Delta::Added => FileStatus::Added,
            git2::Delta::Modified => FileStatus::Modified,
            git2::Delta::Deleted => FileStatus::Deleted,
            git2::Delta::Renamed => FileStatus::Renamed,
            git2::Delta::Copied => FileStatus::Copied,
            git2::Delta::Typechange => FileStatus::TypeChange,
            git2::Delta::Unmodified => FileStatus::Unmodified,
            _ => FileStatus::Other,
        };

        let new_file = delta.new_file();
        let old_file = delta.old_file();
        let path = new_file
            .path()
            .or_else(|| old_file.path())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let old_path = if matches!(status, FileStatus::Renamed | FileStatus::Copied) {
            old_file.path().map(|p| p.to_string_lossy().into_owned())
        } else {
            None
        };
        let is_binary = delta.flags().contains(git2::DiffFlags::BINARY)
            || new_file.is_binary()
            || old_file.is_binary();
        let new_size = new_file.size();
        let old_size = old_file.size();
        let too_large = new_size > DIFF_MAX_FILE_BYTES || old_size > DIFF_MAX_FILE_BYTES;

        let mut file_diff = FileDiff {
            path,
            old_path,
            status,
            is_binary,
            truncated: too_large,
            old_size,
            new_size,
            additions: 0,
            deletions: 0,
            hunks: Vec::new(),
        };

        if !is_binary && !too_large {
            let patch = git2::Patch::from_diff(&diff, idx).map_err(git2_err)?;
            if let Some(patch) = patch {
                let num_hunks = patch.num_hunks();
                for h in 0..num_hunks {
                    let (hunk, line_count) = patch.hunk(h).map_err(git2_err)?;
                    let header = String::from_utf8_lossy(hunk.header())
                        .trim_end()
                        .to_string();
                    let mut lines = Vec::with_capacity(line_count);
                    for l in 0..line_count {
                        let line = patch.line_in_hunk(h, l).map_err(git2_err)?;
                        let kind = match line.origin() {
                            '+' => LineKind::Added,
                            '-' => LineKind::Removed,
                            _ => LineKind::Context,
                        };
                        match kind {
                            LineKind::Added => file_diff.additions += 1,
                            LineKind::Removed => file_diff.deletions += 1,
                            LineKind::Context => {}
                        }
                        let raw = String::from_utf8_lossy(line.content());
                        let content = raw.strip_suffix('\n').unwrap_or(&raw).to_string();
                        lines.push(DiffLine {
                            kind,
                            content,
                            old_line_no: line.old_lineno(),
                            new_line_no: line.new_lineno(),
                        });
                    }
                    file_diff.hunks.push(DiffHunk {
                        old_start: hunk.old_start(),
                        old_count: hunk.old_lines(),
                        new_start: hunk.new_start(),
                        new_count: hunk.new_lines(),
                        header,
                        lines,
                    });
                }
            }
        }

        files.push(file_diff);
    }

    let parent_sha = if commit.parent_count() > 0 {
        commit.parent_id(0).ok().map(|id| id.to_string())
    } else {
        None
    };

    Ok(CommitDiff {
        sha: sha.to_string(),
        parent_sha,
        files,
    })
}
