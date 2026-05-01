// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::BackendError;

use super::super::common::{git2_err, open_git2};
use super::status::working_tree_status;

pub fn stage_files(repo_path: &Path, paths: &[String]) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let workdir = repo.workdir().map(|p| p.to_path_buf());
    let mut index = repo.index().map_err(git2_err)?;

    for path in paths {
        let rel = Path::new(path);
        let exists_in_workdir = workdir
            .as_ref()
            .map(|w| w.join(rel).exists())
            .unwrap_or(false);

        if exists_in_workdir {
            index.add_path(rel).map_err(git2_err)?;
        } else {
            // File deleted in workdir — stage the deletion.
            index.remove_path(rel).map_err(git2_err)?;
        }
    }

    index.write().map_err(git2_err)?;
    Ok(())
}

pub fn unstage_files(repo_path: &Path, paths: &[String]) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;

    let head_obj = repo
        .head()
        .ok()
        .and_then(|h| h.peel(git2::ObjectType::Any).ok());

    if let Some(head_obj) = head_obj {
        let specs: Vec<&str> = paths.iter().map(String::as_str).collect();
        repo.reset_default(Some(&head_obj), specs.iter())
            .map_err(git2_err)?;
    } else {
        // Unborn branch (no HEAD commit yet) — clear the matching index entries.
        let mut index = repo.index().map_err(git2_err)?;
        for path in paths {
            let _ = index.remove_path(Path::new(path));
        }
        index.write().map_err(git2_err)?;
    }
    Ok(())
}

/// Stage every unstaged change in the working tree (equivalent to
/// `git add -A`): modifications, deletions, and untracked files — all go
/// into the index in one shot. Returns the list of paths staged so the
/// frontend can update local state without re-reading `working_tree_status`.
///
/// BACKEND: git2 (transitively via `stage_files`) — same blocker as
/// `create_commit`: gix-index has no index-write helpers at 0.37.
pub fn stage_all(repo_path: &Path) -> Result<Vec<String>, BackendError> {
    let status = working_tree_status(repo_path)?;
    let paths: Vec<String> = status.unstaged.into_iter().map(|c| c.path).collect();
    if paths.is_empty() {
        return Ok(paths);
    }
    stage_files(repo_path, &paths)?;
    Ok(paths)
}

/// Reset every staged entry back to HEAD (`git reset HEAD`). On an unborn
/// branch this clears the index entirely. Returns the list of paths that
/// were unstaged.
///
/// BACKEND: git2 (transitively via `unstage_files`) — `reset_default` has
/// no gix equivalent yet (reset operations against the index are still
/// incubating).
pub fn unstage_all(repo_path: &Path) -> Result<Vec<String>, BackendError> {
    let status = working_tree_status(repo_path)?;
    let paths: Vec<String> = status.staged.into_iter().map(|c| c.path).collect();
    if paths.is_empty() {
        return Ok(paths);
    }
    unstage_files(repo_path, &paths)?;
    Ok(paths)
}

/// Destructively discard unstaged changes for the given paths
/// (`git checkout -- <paths>` + `rm` on untracked). Never touches the
/// index — a partially-staged file keeps its staged hunks, only the
/// workdir is reverted to match.
///
/// BACKEND: git2 — needs path-scoped force-checkout from HEAD tree.
/// gix-worktree-state 0.15 has whole-tree checkout but no
/// `CheckoutBuilder::path()` equivalent. Migrate once gix exposes
/// per-path checkout.
///
/// Split per-path by status:
///
/// * tracked + modified/deleted → force-checkout from HEAD tree (workdir
///   snaps back to the committed version).
/// * untracked (WT_NEW) → physically remove from disk.
///
/// Caller MUST confirm destructive intent beforehand; once this returns,
/// uncommitted changes to those paths are gone.
pub fn discard_paths(repo_path: &Path, paths: &[String]) -> Result<(), BackendError> {
    if paths.is_empty() {
        return Ok(());
    }

    let repo = open_git2(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("bare repo: no working tree")))?
        .to_path_buf();

    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(git2_err)?;

    let mut tracked_to_checkout: Vec<String> = Vec::new();
    let mut untracked_to_remove: Vec<String> = Vec::new();

    let requested: std::collections::HashSet<&str> = paths.iter().map(String::as_str).collect();

    for entry in statuses.iter() {
        let path = match entry.path() {
            Some(p) => p.to_string(),
            None => continue,
        };
        if !requested.contains(path.as_str()) {
            continue;
        }
        let st = entry.status();
        if st.contains(git2::Status::WT_NEW) {
            untracked_to_remove.push(path);
        } else if st.intersects(
            git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_RENAMED
                | git2::Status::WT_TYPECHANGE,
        ) {
            tracked_to_checkout.push(path);
        }
    }

    if !tracked_to_checkout.is_empty() {
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout.force().remove_untracked(false);
        for p in &tracked_to_checkout {
            checkout.path(p);
        }
        repo.checkout_head(Some(&mut checkout)).map_err(git2_err)?;
    }

    for rel in untracked_to_remove {
        let absolute = workdir.join(&rel);
        // `rel` came from git status so it refers to a file (or an
        // untracked symlink); `remove_file` handles both. Swallow NotFound
        // defensively — concurrent fs edits shouldn't fail the whole op.
        match std::fs::remove_file(&absolute) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(BackendError::Git(anyhow::anyhow!(
                    "remove untracked '{rel}': {e}"
                )));
            }
        }
    }

    Ok(())
}
