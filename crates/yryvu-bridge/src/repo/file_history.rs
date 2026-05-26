// SPDX-License-Identifier: AGPL-3.0-or-later

//! Per-file commit history with rename-following (issue #7 — `git log
//! --follow` equivalent).
//!
//! Walks commits via `git2::Revwalk`, dropping any that did not touch
//! the tracked path. When a commit *renamed* the path, the walk
//! switches its tracked name to the rename's old path so older history
//! across the rename is preserved.

use std::path::Path;

use serde::Serialize;

use crate::backend::{BackendError, FileStatus};

use super::common::{git2_err, open_git2, short_sha};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntry {
    pub sha: String,
    pub short_sha: String,
    pub author_name: String,
    pub author_email: String,
    /// Unix seconds (UTC).
    pub time: i64,
    pub summary: String,
    pub status: FileStatus,
    /// Set when this commit *renamed* the file. The walker continues
    /// older history under this path. Frontend uses it to render a
    /// "renamed from <old>" marker on the entry.
    pub renamed_from: Option<String>,
}

const DEFAULT_MAX_COMMITS: usize = 1000;

pub fn file_history(
    repo_path: &Path,
    path: &str,
    max: Option<usize>,
) -> Result<Vec<FileHistoryEntry>, BackendError> {
    let repo = open_git2(repo_path)?;
    let mut revwalk = repo.revwalk().map_err(git2_err)?;
    // `set_sorting` must be called BEFORE the push — pushing first and
    // then changing the sorting silently resets the walker, dropping
    // every queued commit. git2 docs: "Once a sorting is applied, you
    // can no longer push or hide any commit." (the inverse holds too).
    revwalk
        .set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)
        .map_err(git2_err)?;
    revwalk.push_head().map_err(git2_err)?;

    let limit = max.unwrap_or(DEFAULT_MAX_COMMITS).max(1);
    let mut tracked_path = path.to_string();
    let mut out = Vec::new();

    for oid_res in revwalk {
        if out.len() >= limit {
            break;
        }
        let oid = oid_res.map_err(git2_err)?;
        let commit = repo.find_commit(oid).map_err(git2_err)?;

        // Diff against the (first) parent — match `git log --follow`'s
        // single-parent semantics. Merge commits without a path change
        // on the first-parent edge are skipped, matching git's default.
        let parent_tree = commit.parents().next().and_then(|p| p.tree().ok());
        let commit_tree = commit.tree().map_err(git2_err)?;

        // No pathspec on the initial tree-to-tree diff: pathspec applied
        // before `find_similar` filters out the OLD-name side of a
        // rename (because the new-name pathspec doesn't match the old
        // path in the parent tree), so libgit2 can't pair them and
        // rename detection fails. Compute the full delta, run rename
        // detection, then filter to the tracked path ourselves.
        let diff = if let Some(pt) = &parent_tree {
            repo.diff_tree_to_tree(Some(pt), Some(&commit_tree), None)
        } else {
            repo.diff_tree_to_tree(None, Some(&commit_tree), None)
        }
        .map_err(git2_err)?;

        let mut find_opts = git2::DiffFindOptions::new();
        find_opts.renames(true).copies(true);
        let mut detected = diff;
        detected
            .find_similar(Some(&mut find_opts))
            .map_err(git2_err)?;

        let mut matched: Option<(FileStatus, Option<String>)> = None;
        for delta in detected.deltas() {
            let new_path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            if new_path != tracked_path {
                continue;
            }
            let status = match delta.status() {
                git2::Delta::Added => FileStatus::Added,
                git2::Delta::Modified => FileStatus::Modified,
                git2::Delta::Deleted => FileStatus::Deleted,
                git2::Delta::Renamed => FileStatus::Renamed,
                git2::Delta::Copied => FileStatus::Copied,
                git2::Delta::Typechange => FileStatus::TypeChange,
                _ => FileStatus::Other,
            };
            let renamed_from = if matches!(status, FileStatus::Renamed | FileStatus::Copied) {
                delta
                    .old_file()
                    .path()
                    .map(|p| p.to_string_lossy().into_owned())
            } else {
                None
            };
            matched = Some((status, renamed_from));
            break;
        }

        let Some((status, renamed_from)) = matched else {
            continue;
        };

        let author = commit.author();
        out.push(FileHistoryEntry {
            sha: oid.to_string(),
            short_sha: short_sha(&oid),
            author_name: author.name().unwrap_or_default().to_string(),
            author_email: author.email().unwrap_or_default().to_string(),
            time: author.when().seconds(),
            summary: commit.summary().unwrap_or_default().to_string(),
            status,
            renamed_from: renamed_from.clone(),
        });

        // If this commit renamed the path, follow the rename backwards.
        if let Some(prev) = renamed_from {
            tracked_path = prev;
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(repo)
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn write(repo: &Path, rel: &str, content: &str) {
        std::fs::write(repo.join(rel), content).unwrap();
    }

    #[test]
    fn lists_commits_in_reverse_chronological_order() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        write(p, "a.txt", "v1\n");
        git(p, &["add", "a.txt"]);
        git(p, &["commit", "-q", "-m", "initial"]);

        write(p, "a.txt", "v2\n");
        git(p, &["commit", "-aq", "-m", "v2"]);

        write(p, "a.txt", "v3\n");
        git(p, &["commit", "-aq", "-m", "v3"]);

        let history = file_history(p, "a.txt", None).unwrap();
        assert_eq!(history.len(), 3);
        assert_eq!(history[0].summary, "v3");
        assert_eq!(history[1].summary, "v2");
        assert_eq!(history[2].summary, "initial");
        assert_eq!(history[2].status, FileStatus::Added);
    }

    #[test]
    fn follows_renames() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        write(p, "old.txt", "hello\n");
        git(p, &["add", "old.txt"]);
        git(p, &["commit", "-q", "-m", "initial old"]);

        // Modify under old name.
        write(p, "old.txt", "hello\nworld\n");
        git(p, &["commit", "-aq", "-m", "old edit"]);

        // Rename to new name.
        git(p, &["mv", "old.txt", "new.txt"]);
        git(p, &["commit", "-q", "-m", "rename old → new"]);

        // Edit under new name.
        write(p, "new.txt", "hello\nworld\n!\n");
        git(p, &["commit", "-aq", "-m", "new edit"]);

        let history = file_history(p, "new.txt", None).unwrap();
        // Expect all 4 commits — rename detection follows backwards.
        assert_eq!(
            history
                .iter()
                .map(|e| e.summary.as_str())
                .collect::<Vec<_>>(),
            vec!["new edit", "rename old → new", "old edit", "initial old"],
        );
        // Rename entry should carry the old path.
        assert_eq!(history[1].status, FileStatus::Renamed);
        assert_eq!(history[1].renamed_from.as_deref(), Some("old.txt"));
    }

    #[test]
    fn respects_max_limit() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        for i in 0..5 {
            write(p, "f.txt", &format!("v{i}\n"));
            if i == 0 {
                git(p, &["add", "f.txt"]);
            }
            git(p, &["commit", "-aq", "-m", &format!("c{i}")]);
        }
        let history = file_history(p, "f.txt", Some(2)).unwrap();
        assert_eq!(history.len(), 2);
    }
}
