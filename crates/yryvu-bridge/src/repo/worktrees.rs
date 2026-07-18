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

        let dirty = is_path_dirty(&workdir);
        out.push(WorktreeInfo {
            workdir,
            branch,
            head,
            is_main: false,
            is_bare: false,
            locked,
            prunable,
            dirty,
            main_repo_workdir: main_workdir.clone(),
        });
    }

    Ok(out)
}

/// Whether the working tree rooted at `workdir` has uncommitted changes
/// (tracked or untracked). Opens the path as its own git2 repo — linked
/// worktrees resolve their `.git` file transparently.
///
/// The default on error is `true`, not `false`: this flag drives the
/// remove dialog's "you have uncommitted work" warning, so a worktree we
/// can't inspect must be assumed dirty. Reporting "clean" when `open` or
/// `statuses` fails would drop the warning and let the user confirm a
/// destructive remove believing there was nothing to lose. An empty path
/// is the one honest "clean": there is no directory to hold work.
fn is_path_dirty(workdir: &str) -> bool {
    if workdir.is_empty() {
        return false;
    }
    let Ok(repo) = git2::Repository::open(workdir) else {
        return true;
    };
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).include_ignored(false);
    repo.statuses(Some(&mut opts))
        .map(|st| !st.is_empty())
        .unwrap_or(true)
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
    let dirty = is_path_dirty(&workdir);
    WorktreeInfo {
        workdir,
        branch,
        head,
        is_main,
        is_bare: repo.is_bare(),
        locked: None,
        prunable: None,
        dirty,
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
pub fn worktree_unlock(repo_path: &Path, target_workdir: &Path) -> Result<(), BackendError> {
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
pub fn worktree_remove(repo_path: &Path, target_workdir: &Path) -> Result<(), BackendError> {
    let main_repo = super::common::open_git2(repo_path)?;
    let wt = find_worktree_by_path(&main_repo, target_workdir)?;

    // Honour the lock. It is the user's explicit "do not touch this"; git
    // itself needs a second `--force` to remove a locked worktree, and
    // `locked(true)` below would have been exactly that second force. Refuse
    // instead, naming the reason — an unlock is a deliberate separate step.
    if let git2::WorktreeLockStatus::Locked(reason) =
        wt.is_locked().map_err(super::common::git2_err)?
    {
        let detail = reason
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(|r| format!(" ({r})"))
            .unwrap_or_default();
        return Err(BackendError::Git(anyhow!(
            "worktree at {} is locked{detail} — unlock it before removing",
            target_workdir.display()
        )));
    }

    // Delete the user's working copy FIRST, then prune the admin dir. If we
    // pruned first (`.git/worktrees/<name>`) and the rmdir then failed, git
    // would no longer recognise the directory as a worktree while the user's
    // work still sat on disk — unlistable and unrecoverable through the UI.
    // This order leaves a still-registered worktree on any failure, which
    // git can prune again.
    if target_workdir.exists() {
        std::fs::remove_dir_all(target_workdir).map_err(|e| {
            BackendError::Git(anyhow!(
                "failed to delete worktree directory {}: {}",
                target_workdir.display(),
                e
            ))
        })?;
    }

    // git2 prune validates by default — `valid` + `working_tree` give the
    // equivalent of a single `--force`. `locked` is intentionally NOT set:
    // the lock is guarded above. The user confirmed via the menu.
    let mut opts = git2::WorktreePruneOptions::new();
    opts.valid(true).working_tree(true);
    wt.prune(Some(&mut opts)).map_err(super::common::git2_err)?;

    crate::undo_log::clear_log_best_effort(repo_path);
    Ok(())
}

/// Add a linked worktree at `path` checked out to `branch`. When
/// `create_branch` is set, `branch` is created at `base` (or HEAD when
/// `base` is `None`) first; otherwise an existing local branch is used.
/// Equivalent to `git worktree add <path> <branch>` /
/// `git worktree add -b <branch> <path> <base>`.
///
/// git2 because gix's worktree creation is still behind unstable
/// feature gates as of 0.68. A branch already checked out in another
/// worktree makes git2 fail — that error is surfaced verbatim.
pub fn worktree_add(
    repo_path: &Path,
    path: &Path,
    branch: &str,
    base: Option<&str>,
    create_branch: bool,
) -> Result<(), BackendError> {
    let repo = super::common::open_git2(repo_path)?;

    let reference = if create_branch {
        let target = repo
            .revparse_single(base.unwrap_or("HEAD"))
            .map_err(super::common::git2_err)?
            .peel_to_commit()
            .map_err(super::common::git2_err)?;
        repo.branch(branch, &target, false)
            .map_err(super::common::git2_err)?
            .into_reference()
    } else {
        repo.find_branch(branch, git2::BranchType::Local)
            .map_err(super::common::git2_err)?
            .into_reference()
    };

    // The admin name under `.git/worktrees/<name>` — derive from the
    // target directory's tail, the same default `git worktree add` uses.
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| BackendError::Git(anyhow!("worktree path has no final segment")))?;

    let mut opts = git2::WorktreeAddOptions::new();
    opts.reference(Some(&reference));
    repo.worktree(name, path, Some(&opts))
        .map_err(super::common::git2_err)?;
    Ok(())
}

/// Prune every prunable linked worktree (admin entries whose working
/// directory is gone / invalid), equivalent to `git worktree prune`.
/// Returns how many were pruned. Locked worktrees are left untouched.
pub fn worktree_prune(repo_path: &Path) -> Result<usize, BackendError> {
    let repo = super::common::open_git2(repo_path)?;
    let names = repo.worktrees().map_err(super::common::git2_err)?;
    let mut pruned = 0;
    for i in 0..names.len() {
        let Some(name) = names.get(i) else { continue };
        let wt = repo.find_worktree(name).map_err(super::common::git2_err)?;
        // Default prune options: only reports prunable when the working
        // tree is missing/invalid and the entry isn't locked.
        let mut opts = git2::WorktreePruneOptions::new();
        if wt.is_prunable(Some(&mut opts)).unwrap_or(false) {
            let mut prune_opts = git2::WorktreePruneOptions::new();
            wt.prune(Some(&mut prune_opts))
                .map_err(super::common::git2_err)?;
            pruned += 1;
        }
    }
    Ok(pruned)
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

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{RepositoryInitOptions, Signature};
    use tempfile::TempDir;

    /// Repo on `main` with an identity configured and one (empty) commit
    /// so HEAD resolves — `worktree_add` needs a commit to branch from.
    fn init() -> (TempDir, git2::Repository) {
        let dir = TempDir::new().unwrap();
        let mut opts = RepositoryInitOptions::new();
        opts.initial_head("main");
        let repo = git2::Repository::init_opts(dir.path(), &opts).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@example.com").unwrap();
        drop(config);
        {
            let sig = Signature::now("Test", "test@example.com").unwrap();
            let mut idx = repo.index().unwrap();
            let tree_oid = idx.write_tree().unwrap();
            let tree = repo.find_tree(tree_oid).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                .unwrap();
        }
        (dir, repo)
    }

    fn linked(list: &[WorktreeInfo]) -> Vec<&WorktreeInfo> {
        list.iter().filter(|w| !w.is_main).collect()
    }

    #[test]
    fn add_creates_new_branch_and_worktree() {
        let (dir, repo) = init();
        let wt_root = TempDir::new().unwrap();
        let path = wt_root.path().join("feature-x");
        worktree_add(dir.path(), &path, "feature/x", None, true).unwrap();

        assert!(path.exists());
        assert!(repo
            .find_branch("feature/x", git2::BranchType::Local)
            .is_ok());
        let list = list_worktrees(dir.path()).unwrap();
        assert_eq!(list.len(), 2);
        assert!(linked(&list).iter().any(|w| w.branch == "feature/x"));
    }

    #[test]
    fn add_checks_out_existing_branch() {
        let (dir, repo) = init();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("existing", &head, false).unwrap();
        let wt_root = TempDir::new().unwrap();
        let path = wt_root.path().join("existing-wt");
        worktree_add(dir.path(), &path, "existing", None, false).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn dirty_flag_tracks_uncommitted_work() {
        let (dir, _repo) = init();
        let wt_root = TempDir::new().unwrap();
        let path = wt_root.path().join("dirty-wt");
        worktree_add(dir.path(), &path, "feature/d", None, true).unwrap();

        let clean = list_worktrees(dir.path()).unwrap();
        assert!(!linked(&clean)[0].dirty);

        std::fs::write(path.join("new.txt"), "uncommitted").unwrap();
        let dirty = list_worktrees(dir.path()).unwrap();
        assert!(linked(&dirty)[0].dirty);
    }

    #[test]
    fn prune_removes_worktrees_with_missing_dir() {
        let (dir, _repo) = init();
        let wt_root = TempDir::new().unwrap();
        let path = wt_root.path().join("gone");
        worktree_add(dir.path(), &path, "feature/g", None, true).unwrap();
        // Delete the working dir behind git's back -> admin entry is now
        // prunable.
        std::fs::remove_dir_all(&path).unwrap();

        assert_eq!(worktree_prune(dir.path()).unwrap(), 1);
        assert_eq!(list_worktrees(dir.path()).unwrap().len(), 1);
    }

    #[test]
    fn remove_refuses_a_locked_worktree() {
        let (dir, _repo) = init();
        let wt_root = TempDir::new().unwrap();
        let path = wt_root.path().join("locked-wt");
        worktree_add(dir.path(), &path, "feature/l", None, true).unwrap();
        std::fs::write(path.join("wip.txt"), "unsaved work").unwrap();
        worktree_lock(dir.path(), &path, Some("in review")).unwrap();

        let err = worktree_remove(dir.path(), &path).unwrap_err();
        let msg = format!("{err}");
        assert!(
            msg.contains("locked"),
            "expected a lock refusal, got: {msg}"
        );
        assert!(msg.contains("in review"), "the lock reason should surface");
        // The lock protected the work: directory and admin entry survive.
        assert!(path.join("wip.txt").exists(), "removed a locked worktree");
        assert_eq!(list_worktrees(dir.path()).unwrap().len(), 2);
    }

    #[test]
    fn remove_deletes_an_unlocked_worktree() {
        let (dir, _repo) = init();
        let wt_root = TempDir::new().unwrap();
        let path = wt_root.path().join("doomed-wt");
        worktree_add(dir.path(), &path, "feature/x", None, true).unwrap();

        worktree_remove(dir.path(), &path).unwrap();
        assert!(!path.exists(), "working directory was not deleted");
        assert_eq!(list_worktrees(dir.path()).unwrap().len(), 1);
    }

    #[test]
    fn is_path_dirty_defaults_to_dirty_when_uninspectable() {
        // A non-existent / non-repo path could be hiding work — assume dirty
        // so the remove dialog still warns.
        let missing = TempDir::new().unwrap();
        let not_a_repo = missing.path().join("not-a-repo");
        std::fs::create_dir_all(&not_a_repo).unwrap();
        std::fs::write(not_a_repo.join("stuff.txt"), "x").unwrap();
        assert!(is_path_dirty(not_a_repo.to_str().unwrap()));
        // An empty path is the one honest "clean".
        assert!(!is_path_dirty(""));
    }
}
