// SPDX-License-Identifier: AGPL-3.0-or-later

//! `list_worktrees` — enumerate the main worktree plus every linked
//! worktree under `.git/worktrees/`. Mirrors what GK exposes through
//! `parseWorktreeList(stdout)` after shelling out to
//! `git worktree list --porcelain -z`, but stays in-process by relying
//! on gix's `Repository::worktrees()` + per-Proxy state.
//!
//! Note: gix's `worktrees()` returns only the **linked** worktrees
//! (folders under `.git/worktrees/`). The main worktree has to be
//! synthesised from `Repository::work_dir()` and `head_id()` and
//! prepended so the first row is always the main one — same ordering
//! convention GK ships.

use std::path::Path;

use anyhow::anyhow;

use crate::backend::{BackendError, WorktreeInfo};

use super::common::open_repo;

pub fn list_worktrees(repo_path: &Path) -> Result<Vec<WorktreeInfo>, BackendError> {
    let repo = open_repo(repo_path)?;
    let main_repo = repo
        .main_repo()
        .map_err(|e| BackendError::Git(anyhow!("open main repo: {e}")))?;

    let main_workdir = main_repo
        .work_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();

    let mut out = Vec::with_capacity(4);
    out.push(worktree_row_from_repo(&main_repo, true, &main_workdir));

    let proxies = main_repo
        .worktrees()
        .map_err(|e| BackendError::Git(anyhow!("enumerate worktrees: {e}")))?;
    for proxy in proxies {
        let workdir = proxy
            .base()
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        let locked = proxy.is_locked().then(|| {
            proxy
                .lock_reason()
                .map(|r| r.to_string())
                .unwrap_or_default()
        });
        let prunable = workdir
            .is_empty()
            .then(|| "gitdir entry missing".to_string());

        let (branch, head) = match proxy.into_repo_with_possibly_inaccessible_worktree() {
            Ok(linked) => head_branch(&linked),
            Err(_) => ("HEAD".to_string(), None),
        };

        out.push(WorktreeInfo {
            workdir,
            branch,
            head,
            is_main: false,
            is_bare: false,
            locked,
            prunable,
            main_repo_workdir: main_workdir.clone(),
        });
    }

    Ok(out)
}

fn worktree_row_from_repo(
    repo: &gix::Repository,
    is_main: bool,
    main_workdir: &str,
) -> WorktreeInfo {
    let workdir = repo
        .work_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let (branch, head) = head_branch(repo);
    WorktreeInfo {
        workdir,
        branch,
        head,
        is_main,
        is_bare: repo.is_bare(),
        locked: None,
        prunable: None,
        main_repo_workdir: main_workdir.to_string(),
    }
}

/// Resolve `(branch, head_sha)` for a worktree's HEAD. Detached
/// worktrees report `branch = "HEAD"`, matching GK's parser default.
fn head_branch(repo: &gix::Repository) -> (String, Option<String>) {
    let branch = repo
        .head_name()
        .ok()
        .flatten()
        .map(|n| n.shorten().to_string())
        .unwrap_or_else(|| "HEAD".to_string());
    let head = repo.head_id().ok().map(|id| id.to_string());
    (branch, head)
}

/// Lock a linked worktree so other repos can't touch it (`git worktree
/// lock`). `reason` shows up in `git worktree list` and in chajá's
/// LeftPanel locked badge.
///
/// Operates on git2 because gix's worktree mutation surface is still
/// behind unstable feature gates as of 0.68. The main worktree itself
/// can't be locked — caller filters by `is_main` upstream.
pub fn worktree_lock(
    repo_path: &Path,
    target_workdir: &Path,
    reason: Option<&str>,
) -> Result<(), BackendError> {
    let main_repo = super::common::open_git2(repo_path)?;
    let wt = find_worktree_by_path(&main_repo, target_workdir)?;
    wt.lock(reason).map_err(super::common::git2_err)?;
    Ok(())
}

/// Unlock a linked worktree. No-op when it wasn't locked — git2 returns
/// `Unlocked` either way; the caller doesn't care.
pub fn worktree_unlock(
    repo_path: &Path,
    target_workdir: &Path,
) -> Result<(), BackendError> {
    let main_repo = super::common::open_git2(repo_path)?;
    let wt = find_worktree_by_path(&main_repo, target_workdir)?;
    wt.unlock().map_err(super::common::git2_err)?;
    Ok(())
}

/// Remove a linked worktree. Equivalent to `git worktree remove --force`
/// — the underlying directory is deleted and the `.git/worktrees/<name>`
/// administrative dir is pruned. The undo log is cleared on success
/// because none of the recorded inverses can be replayed against a
/// disappeared worktree.
pub fn worktree_remove(
    repo_path: &Path,
    target_workdir: &Path,
) -> Result<(), BackendError> {
    let main_repo = super::common::open_git2(repo_path)?;
    let wt = find_worktree_by_path(&main_repo, target_workdir)?;

    // git2 prune validates by default — pass `valid` + `working_tree`
    // flags to get the equivalent of `--force`. The user already
    // confirmed via the menu.
    let mut opts = git2::WorktreePruneOptions::new();
    opts.valid(true).working_tree(true).locked(true);
    wt.prune(Some(&mut opts)).map_err(super::common::git2_err)?;

    // Remove the worktree directory itself — git2's prune only touches
    // the admin dir under .git/worktrees/<name>, not the user's working
    // copy. `git worktree remove` does both, so match that contract.
    if target_workdir.exists() {
        std::fs::remove_dir_all(target_workdir).map_err(|e| {
            BackendError::Git(anyhow!(
                "removed worktree admin dir but failed to delete {}: {}",
                target_workdir.display(),
                e
            ))
        })?;
    }

    crate::undo_log::clear_log_best_effort(repo_path);
    Ok(())
}

/// Walk every linked worktree on `repo` and return the one whose path
/// matches `target` byte-for-byte. Used by lock / unlock / remove —
/// the frontend ships the workdir string from the row click, the
/// backend resolves it to a `git2::Worktree` handle here.
fn find_worktree_by_path(
    repo: &git2::Repository,
    target: &Path,
) -> Result<git2::Worktree, BackendError> {
    let names = repo.worktrees().map_err(super::common::git2_err)?;
    for i in 0..names.len() {
        let name = match names.get(i) {
            Some(n) => n,
            None => continue,
        };
        let wt = repo.find_worktree(name).map_err(super::common::git2_err)?;
        if wt.path() == target {
            return Ok(wt);
        }
    }
    Err(BackendError::Git(anyhow!(
        "no linked worktree found at {}",
        target.display()
    )))
}
