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
use std::process::Command;

use anyhow::anyhow;

use crate::backend::{BackendError, SubmoduleInfo};

use super::branches::ahead_behind;
use super::common::{git2_err, open_git2, open_repo};

mod auto_update;

pub use auto_update::{
    auto_update_all, auto_update_setting, resolve_auto_update, set_auto_update_setting,
};

#[cfg(test)]
mod tests;

/// Resolve the commit summary for a gitlink OID inside a submodule's own
/// repository (issue #60 pointer pane). Returns `None` when the submodule
/// isn't checked out or the commit object isn't present locally (not
/// fetched) — the pane falls back to showing the bare OID.
pub fn submodule_commit_summary(
    repo_path: &Path,
    submodule_path: &str,
    sha: &str,
) -> Result<Option<String>, BackendError> {
    let inner = repo_path.join(submodule_path);
    let Ok(repo) = open_git2(&inner) else {
        return Ok(None);
    };
    let Ok(oid) = git2::Oid::from_str(sha) else {
        return Ok(None);
    };
    let Ok(commit) = repo.find_commit(oid) else {
        return Ok(None);
    };
    Ok(commit.summary().map(str::to_string))
}

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
        let is_dirty = is_initialized && workdir_dirty(&repo_path.join(&path));

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
            is_dirty,
        });
    }

    Ok(out)
}

/// Whether the working tree rooted at `workdir` has uncommitted
/// changes (tracked or untracked). Same contract as the worktree
/// `is_path_dirty` (#20): any error (missing / unreadable path) reads
/// as clean so a broken submodule never blocks the listing.
fn workdir_dirty(workdir: &Path) -> bool {
    let Ok(repo) = git2::Repository::open(workdir) else {
        return false;
    };
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).include_ignored(false);
    repo.statuses(Some(&mut opts))
        .map(|st| !st.is_empty())
        .unwrap_or(false)
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

    // A previously-deinitialized submodule keeps its gitdir cached
    // under `.git/modules/<name>` (that's the point of deinit being
    // cheap to undo). libgit2's update(init=true) insists on a fresh
    // clone there and dies with `Exists` — re-activate through the
    // git CLI instead, which relinks the cached gitdir and checks out
    // the pinned commit without re-cloning.
    let rel_path = sub
        .path()
        .to_str()
        .ok_or_else(|| BackendError::Git(anyhow!("submodule path is not valid utf-8")))?
        .to_owned();
    let cached = repo.path().join("modules").join(name);
    let workdir = repo
        .workdir()
        .ok_or_else(|| BackendError::Git(anyhow!("repo is bare, cannot init submodule")))?
        .to_owned();
    if cached.exists() && !workdir.join(&rel_path).join(".git").exists() {
        drop(sub);
        drop(repo);
        return run_git(
            &workdir,
            &["submodule", "update", "--init", "--", &rel_path],
        );
    }

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

/// Add a submodule by URL into the parent repo at `target_path`
/// (relative to the parent's working tree). Equivalent to
/// `git submodule add -- <url> <target_path>`.
///
/// Three-step flow under the hood:
///   1. `Repository::submodule(url, path, use_gitlink=true)` writes
///      the .gitmodules entry + .git/modules/<name> dir + initial
///      gitlink at `target_path`.
///   2. `Submodule::clone(None)` clones the URL into `target_path`.
///   3. `Submodule::add_finalize()` stages .gitmodules + the gitlink
///      so the next parent commit captures the submodule.
///
/// The user still has to commit .gitmodules + the gitlink — this op
/// only stages them. That's the same boundary `git submodule add`
/// draws: the working-tree mutation finishes here, the commit lives
/// elsewhere.
///
/// Submodule name defaults to the relative path; `name` overrides it
/// and `branch` records `submodule.<name>.branch` in `.gitmodules`
/// (read by `git submodule update --remote`). git2's bare
/// `submodule(...)` constructor accepts neither, so when either knob
/// is set we shell out to `git submodule add` — the GK approach
/// (bundle:381503) and the same boundary `submodule_remove` already
/// draws below.
pub fn submodule_add(
    repo_path: &Path,
    url: &str,
    target_path: &Path,
    branch: Option<&str>,
    name: Option<&str>,
) -> Result<(), BackendError> {
    if branch.is_some() || name.is_some() {
        let target = target_path
            .to_str()
            .ok_or_else(|| BackendError::Git(anyhow!("target path is not valid utf-8")))?;
        let mut args = vec!["submodule", "add"];
        if let Some(n) = name {
            args.extend(["--name", n]);
        }
        if let Some(b) = branch {
            args.extend(["-b", b]);
        }
        args.extend(["--", url, target]);
        let repo = open_git2(repo_path)?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| BackendError::Git(anyhow!("repo is bare, cannot add submodule")))?
            .to_owned();
        drop(repo);
        return run_git(&workdir, &args);
    }
    let repo = open_git2(repo_path)?;
    let mut sub = repo.submodule(url, target_path, true).map_err(git2_err)?;
    sub.clone(None).map_err(git2_err)?;
    sub.add_finalize().map_err(git2_err)?;
    Ok(())
}

/// Copy the `.gitmodules` URL into `.git/config` (and the inner
/// repo's `origin` remote) for `name` — `git submodule sync <name>`.
/// Needed after editing the submodule URL in `.gitmodules` so the
/// registered clone follows the new remote.
pub fn submodule_sync(repo_path: &Path, name: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let mut sub = repo
        .find_submodule(name)
        .map_err(|e| BackendError::Git(anyhow!("find submodule '{name}': {e}")))?;
    sub.sync().map_err(git2_err)
}

/// Force-checkout the parent-pinned commit in the submodule's working
/// tree, discarding local modifications — `git submodule update
/// --force <name>`. The destructive checkout is gated behind a
/// confirmation dialog upstream (the dialog warns harder when the row
/// is dirty).
pub fn submodule_reset(repo_path: &Path, name: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let mut sub = repo
        .find_submodule(name)
        .map_err(|e| BackendError::Git(anyhow!("find submodule '{name}': {e}")))?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    let mut opts = git2::SubmoduleUpdateOptions::new();
    opts.checkout(checkout);
    sub.update(false, Some(&mut opts)).map_err(git2_err)
}

/// Unregister an initialized submodule and clear its working tree
/// directory, keeping the `.gitmodules` entry and the cached gitdir
/// under `.git/modules/<name>` — `git submodule deinit -f <path>`.
/// Re-initializing later is cheap (`submodule_init`). libgit2 has no
/// deinit wrapper, so this shells out like `submodule_remove`.
pub fn submodule_deinit(repo_path: &Path, name: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let sub = repo
        .find_submodule(name)
        .map_err(|e| BackendError::Git(anyhow!("find submodule '{name}': {e}")))?;
    let rel_path = sub
        .path()
        .to_str()
        .ok_or_else(|| BackendError::Git(anyhow!("submodule path is not valid utf-8")))?
        .to_owned();
    let workdir = repo
        .workdir()
        .ok_or_else(|| BackendError::Git(anyhow!("repo is bare, cannot deinit submodule")))?
        .to_owned();
    drop(sub);
    drop(repo);
    run_git(&workdir, &["submodule", "deinit", "-f", "--", &rel_path])
}

/// Run a git CLI subcommand inside `workdir`, folding a non-zero exit
/// into a `BackendError` with the trimmed stderr. Shared by the
/// submodule ops libgit2 doesn't wrap (deinit, remove, add-with-name).
fn run_git(workdir: &Path, args: &[&str]) -> Result<(), BackendError> {
    let out = Command::new("git")
        .args(args)
        .current_dir(workdir)
        .output()
        .map_err(|e| BackendError::Git(anyhow!("spawn git {args:?}: {e}")))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(BackendError::Git(anyhow!(
            "git {args:?} failed: {}",
            stderr.trim()
        )));
    }
    Ok(())
}

/// Remove a submodule end-to-end. libgit2 doesn't wrap submodule
/// removal — the canonical sequence (`git submodule deinit -f` +
/// `git rm -f` + drop the cached gitdir under `.git/modules/<name>`)
/// is what GK shells out to (bundle:381503 pattern), so we do the
/// same. Doing it by hand via libgit2 + std::fs would be ~100 LoC of
/// brittle config / .gitmodules parsing for zero functional gain.
///
/// On success the parent's index has the gitlink removed and
/// `.gitmodules` is updated; the user still needs to commit those
/// changes for the removal to land in history. That's the same
/// boundary `git submodule add` draws via `submodule_add` above.
pub fn submodule_remove(repo_path: &Path, name: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let sub = repo
        .find_submodule(name)
        .map_err(|e| BackendError::Git(anyhow!("find submodule '{name}': {e}")))?;
    let rel_path = sub
        .path()
        .to_str()
        .ok_or_else(|| BackendError::Git(anyhow!("submodule path is not valid utf-8")))?
        .to_owned();
    let workdir = repo
        .workdir()
        .ok_or_else(|| BackendError::Git(anyhow!("repo is bare, cannot remove submodule")))?
        .to_owned();
    let gitdir = repo.path().to_owned();
    drop(sub);
    drop(repo);

    // 1. Clear `.git/config` section and the working tree contents.
    //    `-f` is required when the submodule has local modifications;
    //    chajá guards Remove behind a confirmation dialog upstream.
    run_git(&workdir, &["submodule", "deinit", "-f", "--", &rel_path])?;
    // 2. Drop the gitlink from the index + remove the .gitmodules
    //    entry. Stages the change so the next parent commit captures
    //    the removal.
    run_git(&workdir, &["rm", "-f", "--", &rel_path])?;
    // 3. Drop the cached inner gitdir under .git/modules/<name>. git
    //    leaves it behind on purpose so re-adding the same submodule
    //    is cheap; chajá's Remove is end-to-end, so we wipe it.
    let cached = gitdir.join("modules").join(name);
    if cached.exists() {
        std::fs::remove_dir_all(&cached)
            .map_err(|e| BackendError::Git(anyhow!("remove {}: {e}", cached.display())))?;
    }
    Ok(())
}
