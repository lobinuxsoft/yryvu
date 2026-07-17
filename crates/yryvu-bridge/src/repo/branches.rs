// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use anyhow::{anyhow, Context};

use crate::backend::{BackendError, BranchInfo, BranchKind};

use super::common::{git2_err, open_git2, open_repo, validate_branch_name};

pub fn list_branches(repo_path: &Path) -> Result<Vec<BranchInfo>, BackendError> {
    let repo = open_repo(repo_path)?;
    let head_full = repo
        .head_name()
        .ok()
        .flatten()
        .map(|n| n.as_bstr().to_string());

    let mut out = Vec::new();

    let platform = repo
        .references()
        .context("open references platform")
        .map_err(BackendError::Branch)?;

    // Local branches
    for reference in platform
        .local_branches()
        .context("iterate local branches")
        .map_err(BackendError::Branch)?
    {
        let mut reference =
            reference.map_err(|e| BackendError::Branch(anyhow!("resolve local branch: {e}")))?;
        let full_name = reference.name().as_bstr().to_string();
        let short = reference.name().shorten().to_string();
        let tip = reference
            .peel_to_id_in_place()
            .context("peel local branch tip")
            .map_err(BackendError::Branch)?;
        let tip_sha = tip.to_string();
        let is_head = head_full.as_deref() == Some(full_name.as_str());

        let (upstream, ahead, behind) = match upstream_for(&repo, &short) {
            Ok(Some((upstream_short, upstream_id))) => {
                let (a, b) = ahead_behind(&repo, tip.detach(), upstream_id).unwrap_or((0, 0));
                (Some(upstream_short), a, b)
            }
            _ => (None, 0, 0),
        };

        out.push(BranchInfo {
            name: short,
            full_name,
            kind: BranchKind::Local,
            tip_sha,
            is_head,
            upstream,
            ahead,
            behind,
        });
    }

    // Remote-tracking branches
    for reference in platform
        .remote_branches()
        .context("iterate remote branches")
        .map_err(BackendError::Branch)?
    {
        let mut reference =
            reference.map_err(|e| BackendError::Branch(anyhow!("resolve remote branch: {e}")))?;
        let full_name = reference.name().as_bstr().to_string();
        let short = reference.name().shorten().to_string();
        // Skip symbolic HEAD pointers like refs/remotes/origin/HEAD.
        if short.ends_with("/HEAD") {
            continue;
        }
        let tip = reference
            .peel_to_id_in_place()
            .context("peel remote branch tip")
            .map_err(BackendError::Branch)?;
        out.push(BranchInfo {
            name: short,
            full_name,
            kind: BranchKind::Remote,
            tip_sha: tip.to_string(),
            is_head: false,
            upstream: None,
            ahead: 0,
            behind: 0,
        });
    }

    out.sort_by(|a, b| (a.kind_sort_key(), &a.name).cmp(&(b.kind_sort_key(), &b.name)));
    Ok(out)
}

pub fn create_branch(repo_path: &Path, name: &str, from: Option<&str>) -> Result<(), BackendError> {
    validate_branch_name(name)?;
    let repo = open_repo(repo_path)?;

    let target = match from {
        Some(spec) => repo
            .rev_parse_single(spec.as_bytes())
            .map_err(|e| BackendError::Branch(anyhow::Error::new(e)))?
            .detach(),
        None => repo
            .head_id()
            .context("resolve HEAD")
            .map_err(BackendError::Branch)?
            .detach(),
    };

    let full_name = format!("refs/heads/{name}");

    // Check for pre-existence to return a typed error instead of a gix transaction error.
    if repo.find_reference(full_name.as_str()).is_ok() {
        return Err(BackendError::BranchExists {
            name: name.to_string(),
        });
    }

    repo.reference(
        full_name.as_str(),
        target,
        gix::refs::transaction::PreviousValue::MustNotExist,
        format!("yryvu: create branch {name}"),
    )
    .map_err(|e| BackendError::Branch(anyhow::Error::new(e)))?;

    Ok(())
}

pub fn delete_local_branch(repo_path: &Path, name: &str, force: bool) -> Result<(), BackendError> {
    let repo = open_repo(repo_path)?;
    let full_name = format!("refs/heads/{name}");

    let mut reference =
        repo.find_reference(full_name.as_str())
            .map_err(|_| BackendError::BranchNotFound {
                name: name.to_string(),
            })?;

    // Refuse to delete the currently checked-out branch.
    if let Some(head) = repo.head_name().ok().flatten() {
        if head.as_bstr() == reference.name().as_bstr() {
            return Err(BackendError::Branch(anyhow!(
                "cannot delete the currently checked-out branch '{name}'"
            )));
        }
    }

    // Same refusal for a branch checked out in a *linked* worktree. `force`
    // does not override this: deleting the ref would leave that worktree's
    // HEAD dangling and the commits reachable only via reflog, with no way
    // back through the UI. git itself requires the worktree removed first.
    if let Some(path) = worktree_holding_branch(&repo, reference.name()) {
        return Err(BackendError::Branch(anyhow!(
            "cannot delete branch '{name}': it is checked out in the worktree at {path}"
        )));
    }

    if !force {
        let tip = reference
            .peel_to_id_in_place()
            .context("peel branch tip")
            .map_err(BackendError::Branch)?
            .detach();
        let head = repo
            .head_id()
            .context("resolve HEAD")
            .map_err(BackendError::Branch)?
            .detach();
        if !is_ancestor(&repo, tip, head) {
            return Err(BackendError::BranchUnmerged {
                name: name.to_string(),
            });
        }
    }

    reference
        .delete()
        .map_err(|e| BackendError::Branch(anyhow::Error::new(e)))?;

    Ok(())
}

/// The worktree path that has `branch_ref` checked out, if any linked
/// worktree does. Returns the base directory so the caller can name it in
/// the refusal. Only linked worktrees are inspected — the main worktree's
/// HEAD is guarded separately by the caller. Any worktree we can't open is
/// skipped: an inaccessible worktree can't be holding a live checkout that
/// a delete would corrupt.
fn worktree_holding_branch(
    repo: &gix::Repository,
    branch_ref: &gix::refs::FullNameRef,
) -> Option<String> {
    let main = repo.main_repo().ok()?;
    for proxy in main.worktrees().ok()? {
        let base = proxy.base().ok().map(|p| p.display().to_string());
        let Ok(linked) = proxy.into_repo_with_possibly_inaccessible_worktree() else {
            continue;
        };
        if let Ok(Some(head)) = linked.head_name() {
            if head.as_bstr() == branch_ref.as_bstr() {
                return Some(base.unwrap_or_default());
            }
        }
    }
    None
}

/// Rename `old_name` to `new_name`, the way `git branch -m` does.
///
/// Delegates to libgit2's `git_branch_move` (git2 `Branch::rename`), which
/// does the two things the previous gix implementation did NOT:
///
/// - **Follows HEAD.** `git_reference_rename` updates any HEAD (in every
///   worktree) that symbolically pointed at the renamed branch. The old
///   code only moved the ref, so renaming the checked-out branch left HEAD
///   dangling at a deleted ref — git then read the repo as an *unborn*
///   branch, reported every file as staged, and a commit forked history
///   into a second root.
/// - **Migrates the config.** `git_config_rename_section` moves the whole
///   `[branch "old"]` section (remote / merge / rebase / description), so
///   the upstream survives instead of being orphaned and reported as
///   `upstream: None`.
///
/// Renaming the current branch is therefore safe; the UI keeps the action
/// enabled.
///
/// BACKEND: git2 — gix has ref-rename primitives but neither the
/// worktree-aware HEAD follow nor the config-section migration; hand-rolling
/// both duplicates logic libgit2 already gets right.
pub fn rename_branch(repo_path: &Path, old_name: &str, new_name: &str) -> Result<(), BackendError> {
    validate_branch_name(new_name)?;
    let repo = open_git2(repo_path)?;

    let mut branch = repo
        .find_branch(old_name, git2::BranchType::Local)
        .map_err(|_| BackendError::BranchNotFound {
            name: old_name.to_string(),
        })?;

    // Surface the typed error rather than libgit2's generic "failed to
    // rename" — `rename(.., force=false)` would fail too, but less legibly.
    if repo.find_branch(new_name, git2::BranchType::Local).is_ok() {
        return Err(BackendError::BranchExists {
            name: new_name.to_string(),
        });
    }

    branch.rename(new_name, false).map_err(git2_err)?;
    Ok(())
}

/// Set or clear the upstream for `branch_name`. Pass
/// `Some("origin/main")` to track a specific remote ref, or `None` to
/// clear the tracking config. Equivalent to
/// `git branch --set-upstream-to=<upstream> <branch>` /
/// `git branch --unset-upstream <branch>`.
pub fn set_upstream(
    repo_path: &Path,
    branch_name: &str,
    upstream: Option<&str>,
) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let mut local = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .map_err(|_| BackendError::BranchNotFound {
            name: branch_name.to_string(),
        })?;
    local.set_upstream(upstream).map_err(git2_err)?;
    Ok(())
}

pub fn upstream_for(
    repo: &gix::Repository,
    local_short: &str,
) -> anyhow::Result<Option<(String, gix::ObjectId)>> {
    let config = repo.config_snapshot();
    let remote_key = format!("branch.{local_short}.remote");
    let merge_key = format!("branch.{local_short}.merge");

    let remote = match config.string(remote_key.as_str()) {
        Some(v) => v.to_string(),
        None => return Ok(None),
    };
    let merge_ref = match config.string(merge_key.as_str()) {
        Some(v) => v.to_string(),
        None => return Ok(None),
    };

    let merge_short = merge_ref
        .strip_prefix("refs/heads/")
        .unwrap_or(merge_ref.as_str());
    let upstream_full = format!("refs/remotes/{remote}/{merge_short}");

    let mut reference = match repo.find_reference(upstream_full.as_str()) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };
    let id = reference
        .peel_to_id_in_place()
        .context("peel upstream tip")?
        .detach();
    Ok(Some((format!("{remote}/{merge_short}"), id)))
}

pub fn ahead_behind(
    repo: &gix::Repository,
    local: gix::ObjectId,
    upstream: gix::ObjectId,
) -> anyhow::Result<(u32, u32)> {
    let base = repo.merge_base(local, upstream)?.detach();
    let ahead = count_revs(repo, local, base)?;
    let behind = count_revs(repo, upstream, base)?;
    Ok((ahead, behind))
}

pub fn count_revs(
    repo: &gix::Repository,
    from: gix::ObjectId,
    excluding: gix::ObjectId,
) -> anyhow::Result<u32> {
    if from == excluding {
        return Ok(0);
    }
    let walk = repo
        .rev_walk(Some(from))
        .with_pruned(Some(excluding))
        .all()?;
    let mut count = 0u32;
    for info in walk {
        let info = info?;
        if info.id == excluding {
            continue;
        }
        count = count.saturating_add(1);
    }
    Ok(count)
}

pub fn is_ancestor(
    repo: &gix::Repository,
    ancestor: gix::ObjectId,
    descendant: gix::ObjectId,
) -> bool {
    if ancestor == descendant {
        return true;
    }
    match repo.merge_base(ancestor, descendant) {
        Ok(base) => base.detach() == ancestor,
        Err(_) => false,
    }
}

impl BranchInfo {
    fn kind_sort_key(&self) -> u8 {
        match self.kind {
            BranchKind::Local => 0,
            BranchKind::Remote => 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(cwd: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn out(cwd: &Path, args: &[&str]) -> String {
        String::from_utf8(
            Command::new("git")
                .args(args)
                .current_dir(cwd)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string()
    }

    fn identity(repo: &Path) {
        git(repo, &["config", "user.name", "t"]);
        git(repo, &["config", "user.email", "t@t"]);
    }

    fn repo_on_main() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_path_buf();
        git(&p, &["init", "-q", "-b", "main"]);
        identity(&p);
        std::fs::write(p.join("a.txt"), "base\n").unwrap();
        git(&p, &["add", "."]);
        git(&p, &["commit", "-qm", "base"]);
        (dir, p)
    }

    /// Renaming the checked-out branch must move HEAD with it. Otherwise
    /// HEAD dangles at the deleted ref, the repo reads as an unborn branch,
    /// and the next commit forks history into a second root (#455).
    #[test]
    fn rename_current_branch_keeps_head_attached() {
        let (_d, p) = repo_on_main();
        let tip = out(&p, &["rev-parse", "HEAD"]);

        rename_branch(&p, "main", "trunk").unwrap();

        assert_eq!(
            out(&p, &["symbolic-ref", "HEAD"]),
            "refs/heads/trunk",
            "HEAD did not follow the rename"
        );
        assert_eq!(out(&p, &["rev-parse", "HEAD"]), tip, "trunk lost the tip");
        // The clean-tree tell: an attached HEAD reports the branch, a
        // dangling one reports "No commits yet".
        assert_eq!(out(&p, &["rev-parse", "--abbrev-ref", "HEAD"]), "trunk");
        assert!(
            out(&p, &["status", "--porcelain"]).is_empty(),
            "a detached HEAD would surface every file as staged"
        );
        assert!(
            repo_on_main_ref_gone(&p),
            "old ref refs/heads/main still present"
        );
    }

    fn repo_on_main_ref_gone(p: &Path) -> bool {
        Command::new("git")
            .args(["show-ref", "--verify", "--quiet", "refs/heads/main"])
            .current_dir(p)
            .status()
            .unwrap()
            .code()
            != Some(0)
    }

    /// The `[branch "old"]` config — remote + merge — must ride along, or
    /// the upstream is orphaned and the branch reports no tracking (#455).
    #[test]
    fn rename_branch_keeps_upstream() {
        let (_d, p) = repo_on_main();
        // Fake an upstream by writing the tracking config git would set.
        git(&p, &["config", "branch.main.remote", "origin"]);
        git(&p, &["config", "branch.main.merge", "refs/heads/main"]);

        rename_branch(&p, "main", "trunk").unwrap();

        assert_eq!(out(&p, &["config", "branch.trunk.remote"]), "origin");
        assert_eq!(
            out(&p, &["config", "branch.trunk.merge"]),
            "refs/heads/main"
        );
        // The stale section must be gone, not left orphaned.
        assert!(
            !out(&p, &["config", "--get-regexp", "^branch\\.main\\."]).contains("branch.main"),
            "stale branch.main.* config left behind"
        );
    }

    /// Renaming to a name that already exists must surface the typed error.
    #[test]
    fn rename_to_existing_branch_is_rejected() {
        let (_d, p) = repo_on_main();
        git(&p, &["branch", "other"]);
        let err = rename_branch(&p, "main", "other").unwrap_err();
        assert!(
            matches!(err, BackendError::BranchExists { .. }),
            "expected BranchExists, got {err:?}"
        );
    }

    /// A branch checked out in a linked worktree must not be deletable —
    /// even with force. Deleting the ref would strand the worktree's HEAD
    /// and the commits would survive only in the reflog (#457).
    #[test]
    fn delete_branch_checked_out_in_worktree_is_refused_even_with_force() {
        let (_d, p) = repo_on_main();
        git(&p, &["branch", "feature"]);
        // A dedicated tempdir so the worktree path never collides with a
        // parallel test run.
        let wt_dir = tempfile::tempdir().unwrap();
        let wt = wt_dir.path().join("wt-feature");
        git(
            &p,
            &["worktree", "add", "-q", wt.to_str().unwrap(), "feature"],
        );

        // Force on: the guard must still refuse.
        let err = delete_local_branch(&p, "feature", true).unwrap_err();
        assert!(
            matches!(err, BackendError::Branch(_)),
            "expected a Branch refusal, got {err:?}"
        );
        assert!(
            format!("{err}").contains("worktree"),
            "the refusal should name the worktree, got: {err}"
        );
        // The ref must survive so the worktree stays valid.
        assert_eq!(
            out(&p, &["rev-parse", "--verify", "refs/heads/feature"]),
            out(&wt, &["rev-parse", "HEAD"]),
            "the branch ref was deleted despite the guard"
        );
    }
}
