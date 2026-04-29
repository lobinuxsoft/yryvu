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
