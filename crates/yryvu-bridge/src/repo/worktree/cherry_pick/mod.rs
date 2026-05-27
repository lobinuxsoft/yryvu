// SPDX-License-Identifier: AGPL-3.0-or-later

#[cfg(test)]
mod tests;

use std::path::Path;

use crate::backend::BackendError;
use crate::repo::common::{git2_err, open_git2};
use crate::undo_log::{record_op_best_effort, OpKind};

use super::{checkout_branch, current_head_label, is_working_tree_dirty};

/// Apply `sha` on top of the currently checked-out branch. Thin wrapper
/// around [`cherry_pick_commits_onto`] for the single-commit / no-branch-
/// picker path used by the drop popover (issue #9).
pub fn cherry_pick_commit(repo_path: &Path, sha: &str) -> Result<(), BackendError> {
    cherry_pick_commits_onto(repo_path, std::slice::from_ref(&sha), None)
}

/// Cherry-pick one or more commits, optionally switching to `target_branch`
/// first. Powers issue #13 — branch picker + multi-select batch.
///
/// `shas` must be in the order the user intends them to land (oldest first
/// for chronological replay). Each pick is committed before the next
/// starts; on conflict the loop aborts and the repo is left in cherry-pick
/// state on whatever branch is currently checked out — the user can resolve
/// + continue manually, matching the existing single-pick conflict UX.
///
/// `target_branch`:
/// * `None` — apply onto the current branch (legacy behaviour).
/// * `Some(name)` — if `name` differs from the current HEAD label, the
///   working tree must be clean (otherwise [`BackendError::WorkingTreeDirty`])
///   and we `checkout_branch(name)` before the loop. We do **not** restore
///   the previous branch on success: the user picked "onto X" expecting
///   HEAD to be X with the new commits, matching GitKraken's
///   `PendingInteractiveRebasePanel-CherryPickingXCommitsOnto` flow.
pub fn cherry_pick_commits_onto(
    repo_path: &Path,
    shas: &[&str],
    target_branch: Option<&str>,
) -> Result<(), BackendError> {
    if shas.is_empty() {
        return Ok(());
    }

    if let Some(target) = target_branch {
        let needs_checkout = {
            let repo = open_git2(repo_path)?;
            current_head_label(&repo).as_deref() != Some(target)
        };
        if needs_checkout {
            // Pre-flight: a dirty tree would surface as a raw libgit2 error
            // from `checkout_tree`. Convert to the typed variant so the
            // frontend can offer the same auto-stash path it uses for plain
            // `Checkout this commit` (see `tryCheckout` in `useCommitOps`).
            if is_working_tree_dirty(repo_path)? {
                return Err(BackendError::WorkingTreeDirty);
            }
            checkout_branch(repo_path, target)?;
        }
    }

    for sha in shas {
        cherry_pick_single(repo_path, sha)?;
    }
    Ok(())
}

/// Apply a single commit onto HEAD as a new commit, mirroring
/// `git cherry-pick <sha>`. Author identity is preserved from the source
/// commit; committer is the current repo signature (fulfilling acceptance
/// "Preserves author vs committer info correctly" from issue #13).
fn cherry_pick_single(repo_path: &Path, sha: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let oid = git2::Oid::from_str(sha).map_err(|_| BackendError::CommitNotFound {
        sha: sha.to_string(),
    })?;
    let commit = repo
        .find_commit(oid)
        .map_err(|_| BackendError::CommitNotFound {
            sha: sha.to_string(),
        })?;

    repo.cherrypick(&commit, None).map_err(git2_err)?;

    // If the cherry-pick produced conflicts, git2 writes them to the index
    // and leaves CHERRY_PICK_HEAD in place. Surface MergeConflict so the
    // UI's StateBanner can pick it up and offer an abort.
    let index = repo.index().map_err(git2_err)?;
    if index.has_conflicts() {
        let paths: Vec<String> = index
            .conflicts()
            .map_err(git2_err)?
            .filter_map(|c| c.ok())
            .filter_map(|c| c.our.or(c.their).or(c.ancestor))
            .map(|e| String::from_utf8_lossy(&e.path).into_owned())
            .collect();
        return Err(BackendError::MergeConflict { paths });
    }

    // Clean apply — write the cherry-pick as a new commit on HEAD.
    let tree_oid = repo
        .index()
        .map_err(git2_err)?
        .write_tree()
        .map_err(git2_err)?;
    let tree = repo.find_tree(tree_oid).map_err(git2_err)?;
    let head = repo.head().map_err(git2_err)?;
    let parent_commit = head.peel_to_commit().map_err(git2_err)?;
    let sig = repo.signature().map_err(git2_err)?;
    let new_oid = repo
        .commit(
            Some("HEAD"),
            &commit.author(),
            &sig,
            commit.message().unwrap_or(""),
            &tree,
            &[&parent_commit],
        )
        .map_err(git2_err)?;
    repo.cleanup_state().map_err(git2_err)?;
    record_op_best_effort(
        repo_path,
        OpKind::CherryPick {
            applied_sha: sha.to_string(),
            new_sha: new_oid.to_string(),
        },
    );
    Ok(())
}
