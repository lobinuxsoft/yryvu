// SPDX-License-Identifier: AGPL-3.0-or-later

//! The undo direction: run the inverse of the most-recent op.

use std::path::Path;

use crate::backend::{BackendError, ResetMode};
use crate::repo::common::{git2_err, open_git2};
use crate::repo::worktree;
use crate::undo_log::{with_record_skipped, OpKind};

use super::shared::{guard_dirty, hard_reset, soft_reset, untrackable, UndoOutcome};

/// Does undoing `op` reset the working tree, taking uncommitted work with
/// it? A `--hard` reset is the right call for these inverses — undoing a
/// cherry-pick has to make the commit's content *disappear*, not leave it
/// behind unstaged — but it cannot tell the op's content apart from the
/// user's own uncommitted edits, so it discards both.
///
/// Exhaustive on purpose: a new [`OpKind`] must decide here rather than
/// inherit a permissive default. That omission is how these bugs are born.
fn undo_discards_uncommitted_work(op: &OpKind) -> bool {
    match op {
        // Soft reset: the tree is left exactly as it is.
        OpKind::Commit { .. } => false,
        OpKind::Amend { .. } => true,
        // Safe checkout — refuses on a dirty tree by itself.
        OpKind::CheckoutBranch { .. } | OpKind::CheckoutCommit { .. } => false,
        OpKind::Reset { mode, .. } => matches!(mode, ResetMode::Hard),
        OpKind::CherryPick { .. } | OpKind::Revert { .. } | OpKind::Merge { .. } => true,
        // Pops the stash back — applies, never resets.
        OpKind::StashPush { .. } => false,
        // Reported as untrackable; nothing runs.
        OpKind::StashPop { .. } => false,
    }
}

/// Apply the inverse of `op` against `repo_path`. Errors propagate as
/// `BackendError` so the UI can surface them through its standard
/// notification channel.
///
/// Destructive inverses refuse over a dirty working tree unless `force`;
/// see [`guard_dirty`](super::shared::guard_dirty).
///
/// The whole match runs inside [`with_record_skipped`] so the public op
/// wrappers we delegate to (`checkout_branch`, `reset_to_commit`, …)
/// don't append fresh log entries — undo moves the cursor backwards,
/// it doesn't synthesise a "undo of X" record.
pub fn apply_inverse(
    repo_path: &Path,
    op: &OpKind,
    force: bool,
) -> Result<UndoOutcome, BackendError> {
    let discarded = guard_dirty(repo_path, undo_discards_uncommitted_work(op), force)?;
    let outcome = with_record_skipped(|| apply_inverse_inner(repo_path, op))?;
    Ok(outcome.with_discarded_dirty(discarded))
}

fn apply_inverse_inner(repo_path: &Path, op: &OpKind) -> Result<UndoOutcome, BackendError> {
    match op {
        OpKind::Commit {
            parent_sha: Some(parent_sha),
            ..
        } => {
            soft_reset(repo_path, parent_sha)?;
            Ok(UndoOutcome::applied("commit"))
        }
        OpKind::Amend { old_sha, .. } => {
            hard_reset(repo_path, old_sha)?;
            Ok(UndoOutcome::applied("amend"))
        }
        OpKind::CheckoutBranch { from, .. } => {
            worktree::checkout_branch(repo_path, from)?;
            Ok(UndoOutcome::applied("checkout"))
        }
        OpKind::CheckoutCommit { from, .. } => {
            // `from` may be a branch shorthand or a 40-char SHA — try
            // branch first, fall back to commit checkout. Detached HEADs
            // round-trip as the SHA string.
            match worktree::checkout_branch(repo_path, from) {
                Ok(()) => Ok(UndoOutcome::applied("checkout")),
                Err(BackendError::BranchNotFound { .. }) => {
                    worktree::checkout_commit(repo_path, from)?;
                    Ok(UndoOutcome::applied("checkout"))
                }
                Err(e) => Err(e),
            }
        }
        OpKind::Reset { from_sha, mode, .. } => {
            // Reset with the same mode against the original from-sha
            // inverts a Soft reset exactly. For Mixed the original reset
            // re-read the tree into the index (reset.c), discarding the
            // staging; this inverse restores content but NOT the prior
            // staging state — files come back unstaged. No content is
            // lost. (Restoring the index is tracked separately — it needs
            // OpKind::Reset to record the pre-reset index tree.) Note: we
            // go through the public `reset_to_commit` helper so the inverse itself
            // appends a new log entry — that means consecutive undos of
            // a reset will keep stepping back through history.
            // Acceptable for sub-PR 2; the cursor logic in commands/undo.rs
            // handles the bookkeeping.
            worktree::reset_to_commit(repo_path, from_sha, *mode)?;
            Ok(UndoOutcome::applied("reset"))
        }
        OpKind::CherryPick { new_sha, .. } | OpKind::Revert { new_sha, .. } => {
            let label = if matches!(op, OpKind::CherryPick { .. }) {
                "cherry-pick"
            } else {
                "revert"
            };
            reset_synthesised_commit(repo_path, new_sha, label)
        }
        OpKind::Merge { pre_merge_sha, .. } => {
            hard_reset(repo_path, pre_merge_sha)?;
            Ok(UndoOutcome::applied("merge"))
        }
        OpKind::StashPush { stash_sha, .. } => {
            // Pop the exact stash we pushed, not whatever is on top now —
            // the user may have stashed again since.
            worktree::stash_pop_by_sha(repo_path, stash_sha)?;
            Ok(UndoOutcome::applied("stash push"))
        }
        // The ops with no inverse. The reason text lives on `OpKind` so
        // the toolbar can grey the button out ahead of time instead of
        // lighting up a control that reports this toast forever (#474).
        OpKind::Commit {
            parent_sha: None, ..
        }
        | OpKind::StashPop { .. } => Ok(untrackable(op.undo_untrackable_reason())),
    }
}

/// Undo a cherry-pick / revert by hard-resetting to the parent of the
/// commit it created — but only after confirming HEAD *still is* that
/// commit. Both ops synthesise a single-parent commit on top of HEAD, so
/// their inverse is a reset to that parent.
///
/// Doing it relative to HEAD (`HEAD~1`) was blind: any commit made outside
/// the app (or a sidecar write that silently failed) leaves HEAD pointing
/// at the user's own work, and `reset --hard HEAD~1` would destroy that
/// instead of the op's commit — the exact opposite of what "undo the
/// cherry-pick" means. The `Merge` and `Commit` arms already reset by
/// recorded SHA; this brings cherry-pick / revert in line (#461).
fn reset_synthesised_commit(
    repo_path: &Path,
    new_sha: &str,
    label: &str,
) -> Result<UndoOutcome, BackendError> {
    let repo = open_git2(repo_path)?;
    let expected = git2::Oid::from_str(new_sha).map_err(|_| BackendError::CommitNotFound {
        sha: new_sha.to_string(),
    })?;
    let head_oid = repo
        .head()
        .map_err(git2_err)?
        .peel_to_commit()
        .map_err(git2_err)?
        .id();
    if head_oid != expected {
        return Err(BackendError::UndoHeadMismatch {
            op: label.to_string(),
        });
    }
    let commit = repo
        .find_commit(expected)
        .map_err(|_| BackendError::CommitNotFound {
            sha: new_sha.to_string(),
        })?;
    let parent = commit.parent(0).map_err(git2_err)?;
    let obj = repo.find_object(parent.id(), None).map_err(git2_err)?;
    repo.reset(&obj, git2::ResetType::Hard, None)
        .map_err(git2_err)?;
    Ok(UndoOutcome::applied(label))
}
