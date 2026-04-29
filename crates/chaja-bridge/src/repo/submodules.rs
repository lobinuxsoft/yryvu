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
use super::common::open_repo;

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
