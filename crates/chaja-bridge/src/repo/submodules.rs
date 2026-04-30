// SPDX-License-Identifier: AGPL-3.0-or-later

//! `list_submodules` — enumerate every submodule declared in
//! `.gitmodules`. Mirrors what GK pulls from `git submodule status`
//! plus the per-submodule inner-repo open, but stays in-process via
//! gix's `Repository::submodules()` + per-Submodule `state()` /
//! `head_id()` / `index_id()` / `open()`.
//!
//! `ahead` / `behind` compare the submodule's checked-out HEAD against
//! the parent-pinned commit (the SHA recorded in the parent's HEAD
//! tree). Both default to zero whenever the comparison can't be
//! performed (uninitialized submodule, missing inner repo, missing
//! commit objects) so the UI never has to handle a partially-failed
//! row.

use std::path::Path;

use anyhow::anyhow;

use crate::backend::{BackendError, SubmoduleInfo};

use super::branches::ahead_behind;
use super::common::{git2_err, open_git2, open_repo};

pub fn list_submodules(repo_path: &Path) -> Result<Vec<SubmoduleInfo>, BackendError> {
    let repo = open_repo(repo_path)?;
    let iter = match repo
        .submodules()
        .map_err(|e| BackendError::Git(anyhow!("open .gitmodules: {e}")))?
    {
        Some(it) => it,
        None => return Ok(Vec::new()),
    };

    let mut out = Vec::new();
    for sub in iter {
        let name = sub.name().to_string();
        let path = sub
            .path()
            .map(|p| p.to_string())
            .unwrap_or_else(|_| name.clone());
        let url = sub.url().ok().map(|u| u.to_bstring().to_string());

        let head_sha = sub.head_id().ok().flatten().map(|id| id.to_string());
        let index_sha = sub.index_id().ok().flatten().map(|id| id.to_string());

        let state = sub.state().ok();
        let is_initialized = state
            .as_ref()
            .map(|s| s.repository_exists && s.worktree_checkout)
            .unwrap_or(false);
        let is_deleted = state
            .as_ref()
            .map(|s| !s.worktree_checkout && head_sha.is_some())
            .unwrap_or(false);

        let (ahead, behind) = if is_initialized {
            submodule_ahead_behind(&sub, head_sha.as_deref()).unwrap_or((0, 0))
        } else {
            (0, 0)
        };

        out.push(SubmoduleInfo {
            name,
            path,
            url,
            head_sha,
            index_sha,
            is_initialized,
            is_deleted,
            ahead,
            behind,
        });
    }

    Ok(out)
}

/// Compare the submodule's checked-out HEAD against the parent's
/// pinned commit. Returns `None` when either the inner repo cannot be
/// opened or the pinned commit isn't reachable from inside the
/// submodule's object store.
fn submodule_ahead_behind(
    sub: &gix::Submodule<'_>,
    pinned_sha: Option<&str>,
) -> Option<(u32, u32)> {
    let pinned_sha = pinned_sha?;
    let inner = sub.open().ok().flatten()?;
    let inner_head = inner.head_id().ok()?.detach();
    let pinned_oid = gix::ObjectId::from_hex(pinned_sha.as_bytes()).ok()?;
    if inner_head == pinned_oid {
        return Some((0, 0));
    }
    ahead_behind(&inner, inner_head, pinned_oid).ok()
}

/// Initialize a submodule and clone its working tree if missing.
/// Wraps `git2::Submodule::init(false)` (registers `.gitmodules` →
/// `.git/config`) followed by `update(init: true)` which clones the
/// inner repo + checks out the parent-pinned commit.
///
/// Already-initialized submodules see this as a no-op on the registry
/// step but still get a fresh clone if the inner dir is missing.
///
/// Backend choice: git2 — gix's submodule mutation surface is still
/// experimental. The mutation entry points (init / update / reset)
/// all live on git2 until gix catches up, matching the worktree
/// pattern we settled on in #225.
pub fn submodule_init(repo_path: &Path, name: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let mut sub = repo
        .find_submodule(name)
        .map_err(|e| BackendError::Git(anyhow!("find submodule '{name}': {e}")))?;
    sub.init(false).map_err(git2_err)?;
    let mut opts = git2::SubmoduleUpdateOptions::new();
    sub.update(true, Some(&mut opts)).map_err(git2_err)?;
    Ok(())
}

/// Fetch + checkout the parent-pinned SHA in the inner submodule
/// working tree. Equivalent to `git submodule update <name>`. Assumes
/// the submodule is already initialized — for a fresh clone use
/// `submodule_init` instead. Errors if the submodule was never
/// initialized.
pub fn submodule_update(repo_path: &Path, name: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let mut sub = repo
        .find_submodule(name)
        .map_err(|e| BackendError::Git(anyhow!("find submodule '{name}': {e}")))?;
    let mut opts = git2::SubmoduleUpdateOptions::new();
    sub.update(false, Some(&mut opts)).map_err(git2_err)?;
    Ok(())
}
