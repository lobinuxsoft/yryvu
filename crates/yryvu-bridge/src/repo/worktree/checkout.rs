// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use anyhow::anyhow;

use crate::backend::BackendError;
use crate::repo::common::{git2_err, open_git2};
use crate::undo_log::{record_op_best_effort, OpKind};

use super::current_head_label;

pub fn is_working_tree_dirty(repo_path: &Path) -> Result<bool, BackendError> {
    let repo = open_git2(repo_path)?;
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(git2_err)?;
    Ok(!statuses.is_empty())
}

pub fn checkout_branch(repo_path: &Path, name: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let full_name = format!("refs/heads/{name}");

    repo.find_reference(&full_name)
        .map_err(|_| BackendError::BranchNotFound {
            name: name.to_string(),
        })?;

    let from = current_head_label(&repo);
    let obj = repo.revparse_single(&full_name).map_err(git2_err)?;

    // Default checkout is safe: it refuses when the working tree would lose
    // uncommitted changes. The UI is expected to call is_working_tree_dirty
    // first and prompt the user.
    repo.checkout_tree(&obj, None).map_err(git2_err)?;
    repo.set_head(&full_name).map_err(git2_err)?;
    if let Some(from) = from {
        record_op_best_effort(
            repo_path,
            OpKind::CheckoutBranch {
                from,
                to: name.to_string(),
            },
        );
    }
    Ok(())
}

/// Checkout a remote-tracking ref by creating-or-switching to a local
/// branch that tracks it. Powers `Checkout` on a remote branch row
/// (#222 / GK's `popupRefMenu` for `BranchType::Remote`).
///
/// `full_remote_name` is the short form returned by gix /git2 for remote
/// branches — e.g. `origin/feature-x` (no `refs/remotes/` prefix). The
/// local branch is given the trailing path component (`feature-x`) so a
/// remote like `origin/feature/x` becomes a local `feature/x`. When the
/// local branch already exists it is reused — chajá deviates from GK's
/// "force-create" by NOT overwriting the user's local work; switching
/// to the existing branch is the safe default.
pub fn checkout_remote_tracking(
    repo_path: &Path,
    full_remote_name: &str,
) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;

    // origin/feature/x → ("origin", "feature/x"). Falls back to using the
    // whole input as the local short name if there is no slash, which is
    // unusual for a remote branch but harmless.
    let (_remote, short) = full_remote_name
        .split_once('/')
        .unwrap_or(("", full_remote_name));
    if short.is_empty() {
        return Err(BackendError::Branch(anyhow!(
            "remote branch '{full_remote_name}' has no branch component"
        )));
    }

    // If the local branch already exists, just switch to it. Existing
    // upstream config (if any) is left intact — the user has likely
    // already wired this branch up the way they want it.
    if repo
        .find_branch(short, git2::BranchType::Local)
        .ok()
        .is_some()
    {
        return checkout_branch(repo_path, short);
    }

    // Resolve the remote ref's tip and write a new local branch at that
    // commit, then set its upstream so subsequent push/pull know the
    // tracking partner.
    let remote_branch = repo
        .find_branch(full_remote_name, git2::BranchType::Remote)
        .map_err(|_| BackendError::BranchNotFound {
            name: full_remote_name.to_string(),
        })?;
    let target = remote_branch
        .get()
        .target()
        .ok_or_else(|| BackendError::Branch(anyhow!("remote branch has no target oid")))?;
    let tip = repo.find_commit(target).map_err(git2_err)?;

    let mut local = repo
        .branch(short, &tip, false)
        .map_err(|e| BackendError::Branch(anyhow::Error::new(e)))?;
    local
        .set_upstream(Some(full_remote_name))
        .map_err(|e| BackendError::Branch(anyhow::Error::new(e)))?;

    // Now switch to the freshly-created local branch via the standard
    // checkout path so the undo log + reflog get the same `CheckoutBranch`
    // entry as a manual switch.
    checkout_branch(repo_path, short)
}

pub fn checkout_commit(repo_path: &Path, sha: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let oid = git2::Oid::from_str(sha).map_err(|_| BackendError::CommitNotFound {
        sha: sha.to_string(),
    })?;
    let obj = repo
        .find_object(oid, None)
        .map_err(|_| BackendError::CommitNotFound {
            sha: sha.to_string(),
        })?;

    let from = current_head_label(&repo);

    // Safe checkout: git2 refuses to overwrite uncommitted changes. The UI is
    // expected to call `is_working_tree_dirty` first and prompt the user.
    repo.checkout_tree(&obj, None).map_err(git2_err)?;
    repo.set_head_detached(oid).map_err(git2_err)?;
    if let Some(from) = from {
        record_op_best_effort(
            repo_path,
            OpKind::CheckoutCommit {
                from,
                to_sha: sha.to_string(),
            },
        );
    }
    Ok(())
}
