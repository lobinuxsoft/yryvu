// SPDX-License-Identifier: AGPL-3.0-or-later

//! `list_stashes` — enumerate `refs/stash` entries by walking its
//! reflog, newest-first. Each reflog entry's `new_oid` is one stash
//! commit in the stack (`stash@{0}`, `stash@{1}`, …). For each stash
//! commit we decode the parents to surface the same triple GK exposes:
//!
//!   - `parent_sha` — the WIP base commit (where HEAD was when stashed).
//!   - `index_sha` — the index state at stash time (parent 1).
//!   - `untracked_sha` — the untracked-files state (parent 2, present iff
//!     the stash was taken with `--include-untracked`).
//!
//! `branch_name` is parsed from the stash message (git's canonical
//! formats are `WIP on <branch>: <sha> <subject>` and
//! `On <branch>: <message>`) since the commit object itself doesn't
//! record the source branch.

use std::path::Path;

use anyhow::{anyhow, Context};
use gix::bstr::ByteSlice;

use crate::backend::{BackendError, CommitDiff, StashInfo};

use super::commits::commit_diff;
use super::common::open_repo;

pub fn list_stashes(repo_path: &Path) -> Result<Vec<StashInfo>, BackendError> {
    let repo = open_repo(repo_path)?;
    let reference = match repo.try_find_reference("refs/stash") {
        Ok(Some(r)) => r,
        Ok(None) => return Ok(Vec::new()),
        Err(e) => return Err(BackendError::Git(anyhow!("open refs/stash: {e}"))),
    };

    let mut log_platform = reference.log_iter();
    let lines = log_platform
        .rev()
        .map_err(|e| BackendError::Git(anyhow!("read refs/stash reflog: {e}")))?;
    let Some(lines) = lines else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for line in lines {
        let line = line.map_err(|e| BackendError::Git(anyhow!("parse reflog line: {e}")))?;
        let oid = line.new_oid;

        let commit = match repo.find_object(oid) {
            Ok(obj) => match obj.try_into_commit() {
                Ok(c) => c,
                Err(_) => continue,
            },
            Err(_) => continue,
        };

        let decoded = commit
            .decode()
            .context("decode stash commit")
            .map_err(BackendError::Git)?;

        let mut parents = decoded.parents();
        let parent_sha = match parents.next() {
            Some(id) => id.to_string(),
            None => continue,
        };
        let index_sha = parents.next().map(|id| id.to_string());
        let untracked_sha = parents.next().map(|id| id.to_string());

        let message = decoded.message.trim().as_bstr().to_string();
        let branch_name = parse_branch_name(&message);
        let when = decoded.committer.time.seconds;

        out.push(StashInfo {
            sha: oid.to_string(),
            message,
            branch_name,
            parent_sha,
            index_sha,
            untracked_sha,
            when,
        });
    }

    Ok(out)
}

/// Diff `stash@{index}` against its primary parent (HEAD-at-stash-time).
/// Thin wrapper over [`commit_diff`] — the stash commit's parent slot 0
/// is exactly the base we want to diff against, so the rename-detection +
/// file-list machinery flows through unchanged. The frontend right-panel
/// (issue #173) feeds the returned `CommitDiff` to the standard FileList
/// widget so stash inspection reuses the diff renderer commits already use.
pub fn stash_diff(repo_path: &Path, index: usize) -> Result<CommitDiff, BackendError> {
    let stashes = list_stashes(repo_path)?;
    let entry = stashes
        .get(index)
        .ok_or_else(|| BackendError::Git(anyhow!("stash@{index} out of range")))?;
    commit_diff(repo_path, &entry.sha)
}

/// Recover the source branch from the stash commit message. Git writes
/// stashes with one of two canonical headers:
///
///   - `WIP on <branch>: <sha> <subject>` (the default `git stash push`)
///   - `On <branch>: <subject>` (`git stash push -m <msg>`)
///
/// Returns `None` for non-canonical messages so the UI can fall back to
/// just the message text.
fn parse_branch_name(message: &str) -> Option<String> {
    let first_line = message.lines().next()?;
    let after_prefix = first_line
        .strip_prefix("WIP on ")
        .or_else(|| first_line.strip_prefix("On "))?;
    let colon = after_prefix.find(':')?;
    Some(after_prefix[..colon].to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use graph_core::NodeType;
    use tempfile::TempDir;

    use super::super::commits::walk_commits;
    use super::*;

    fn init_repo() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_path_buf();
        let mut opts = git2::RepositoryInitOptions::new();
        opts.initial_head("main");
        let repo = git2::Repository::init_opts(&path, &opts).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Tester").unwrap();
        cfg.set_str("user.email", "tester@example.com").unwrap();
        cfg.set_str("commit.gpgsign", "false").unwrap();
        (dir, path)
    }

    fn commit_file(repo_path: &Path, file: &str, content: &str, message: &str) {
        fs::write(repo_path.join(file), content).unwrap();
        let repo = git2::Repository::open(repo_path).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(file)).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = repo.signature().unwrap();
        let parents: Vec<git2::Commit<'_>> = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .into_iter()
            .collect();
        let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
            .unwrap();
    }

    /// Stash a dirty change so `refs/stash@{0}` exists. Returns the repo
    /// path for the caller to inspect.
    fn make_stash(repo_path: &Path) {
        // Mutate the tracked file so there is something to stash.
        fs::write(repo_path.join("a.txt"), "dirty\n").unwrap();
        let mut repo = git2::Repository::open(repo_path).unwrap();
        let sig = repo.signature().unwrap();
        repo.stash_save2(&sig, Some("WIP on main: test stash"), None)
            .unwrap();
    }

    #[test]
    fn list_stashes_empty_when_none() {
        let (_dir, path) = init_repo();
        commit_file(&path, "a.txt", "base\n", "base");
        assert!(list_stashes(&path).unwrap().is_empty());
    }

    #[test]
    fn list_stashes_reports_entry_with_message() {
        let (_dir, path) = init_repo();
        commit_file(&path, "a.txt", "base\n", "base");
        make_stash(&path);

        let stashes = list_stashes(&path).unwrap();
        assert_eq!(stashes.len(), 1);
        assert!(stashes[0].message.contains("test stash"));
        assert_eq!(stashes[0].branch_name.as_deref(), Some("main"));
    }

    #[test]
    fn stash_diff_reports_changed_file() {
        let (_dir, path) = init_repo();
        commit_file(&path, "a.txt", "base\n", "base");
        make_stash(&path);

        let diff = stash_diff(&path, 0).unwrap();
        assert!(diff.files.iter().any(|f| f.path == "a.txt"));
    }

    #[test]
    fn stash_diff_out_of_range_errors() {
        let (_dir, path) = init_repo();
        commit_file(&path, "a.txt", "base\n", "base");
        assert!(stash_diff(&path, 0).is_err());
    }

    #[test]
    fn walk_tags_stash_node() {
        let (_dir, path) = init_repo();
        commit_file(&path, "a.txt", "base\n", "base");
        make_stash(&path);

        let rows: Vec<_> = walk_commits(&path).unwrap().map(|r| r.unwrap()).collect();
        let stash_rows: Vec<_> = rows
            .iter()
            .filter(|c| c.node_type == NodeType::Stash)
            .collect();
        assert_eq!(stash_rows.len(), 1, "exactly one stash node expected");
        assert!(stash_rows[0].summary.contains("test stash"));
    }
}
