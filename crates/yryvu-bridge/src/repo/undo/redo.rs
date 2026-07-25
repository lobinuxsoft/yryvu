// SPDX-License-Identifier: AGPL-3.0-or-later

//! The redo direction: re-apply an op after an undo (sub-PR 3 of #130).

use std::path::Path;

use crate::backend::{BackendError, ResetMode};
use crate::repo::worktree;
use crate::undo_log::{with_record_skipped, OpKind};

use super::shared::{guard_dirty, hard_reset, soft_reset, untrackable, UndoOutcome};

/// Same question as [`undo_discards_uncommitted_work`] for the redo
/// direction, which reaches forward with a `--hard` reset to a commit that
/// still exists in the reflog.
///
/// [`undo_discards_uncommitted_work`]: super::inverse
fn redo_discards_uncommitted_work(op: &OpKind) -> bool {
    match op {
        // Soft reset: leaves the tree alone, same as its undo.
        OpKind::Commit { .. } => false,
        OpKind::Amend { .. }
        | OpKind::CherryPick { .. }
        | OpKind::Revert { .. }
        | OpKind::Merge { .. } => true,
        OpKind::CheckoutBranch { .. } | OpKind::CheckoutCommit { .. } => false,
        OpKind::Reset { mode, .. } => matches!(mode, ResetMode::Hard),
        // Re-stashes whatever is in the tree; captures rather than destroys.
        OpKind::StashPush { .. } => false,
        OpKind::StashPop { .. } => false,
    }
}

/// Re-apply `op` after an undo. Mirrors `apply_inverse` but going forward:
/// for any commit-creating op (Commit / Amend / CherryPick / Revert /
/// Merge) the synthesised commit still lives in the reflog (and on disk),
/// so a single `reset --hard <new_sha>` is enough to restore HEAD without
/// reconstructing the tree. Checkout / reset / stash variants delegate to
/// the public worktree helpers, silenced by `with_record_skipped` so the
/// redo doesn't ghost-record.
pub fn apply_redo(repo_path: &Path, op: &OpKind, force: bool) -> Result<UndoOutcome, BackendError> {
    let discarded = guard_dirty(repo_path, redo_discards_uncommitted_work(op), force)?;
    let outcome = with_record_skipped(|| apply_redo_inner(repo_path, op))?;
    Ok(outcome.with_discarded_dirty(discarded))
}

fn apply_redo_inner(repo_path: &Path, op: &OpKind) -> Result<UndoOutcome, BackendError> {
    match op {
        OpKind::Commit { sha, .. } => {
            // Soft, mirroring the undo. The undo of a commit is a soft
            // reset that deliberately keeps the content staged, so redoing
            // it only has to move HEAD back onto the commit that already
            // holds that content. A hard reset here would destroy work the
            // undo went out of its way to preserve — and, since the undo
            // leaves the tree dirty by design, would also trip the dirty
            // guard and make this redo unreachable.
            soft_reset(repo_path, sha)?;
            Ok(UndoOutcome::applied("commit"))
        }
        OpKind::Amend { new_sha, .. } => {
            hard_reset(repo_path, new_sha)?;
            Ok(UndoOutcome::applied("amend"))
        }
        OpKind::CheckoutBranch { to, .. } => {
            worktree::checkout_branch(repo_path, to)?;
            Ok(UndoOutcome::applied("checkout"))
        }
        OpKind::CheckoutCommit { to_sha, .. } => {
            worktree::checkout_commit(repo_path, to_sha)?;
            Ok(UndoOutcome::applied("checkout"))
        }
        OpKind::Reset { mode, to_sha, .. } => {
            worktree::reset_to_commit(repo_path, to_sha, *mode)?;
            Ok(UndoOutcome::applied("reset"))
        }
        OpKind::CherryPick { new_sha, .. } => {
            hard_reset(repo_path, new_sha)?;
            Ok(UndoOutcome::applied("cherry-pick"))
        }
        OpKind::Revert { new_sha, .. } => {
            hard_reset(repo_path, new_sha)?;
            Ok(UndoOutcome::applied("revert"))
        }
        OpKind::Merge { post_merge_sha, .. } => {
            hard_reset(repo_path, post_merge_sha)?;
            Ok(UndoOutcome::applied("merge"))
        }
        OpKind::StashPush {
            include_untracked,
            include_ignored,
            ..
        } => {
            // Re-stashing the current working tree captures whatever's
            // there now — assumed identical to the pre-undo state since
            // the user just popped it back. Producing a different stash
            // SHA than the original is fine: the cursor walk doesn't
            // care about SHA equality. Mirror the original op's flags so
            // the redo captures the same scope it did the first time.
            worktree::stash_push(repo_path, None, *include_untracked, *include_ignored)?;
            Ok(UndoOutcome::applied("stash push"))
        }
        OpKind::StashPop { .. } => Ok(untrackable(op.redo_untrackable_reason())),
    }
}
