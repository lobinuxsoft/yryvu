// SPDX-License-Identifier: AGPL-3.0-or-later

//! Inverse builder for the undo log.
//!
//! Sub-PR 2 of issue #130: reads the sidecar that sub-PR 1 (#183 / #184)
//! populates and runs the inverse of the most-recent op when the user
//! clicks `Undo` in the toolbar.
//!
//! # What "inverse" means per OpKind
//!
//! | Op                          | Inverse                                              |
//! |-----------------------------|------------------------------------------------------|
//! | `Commit { parent: Some }`   | `reset --soft parent_sha` — preserves index + worktree |
//! | `Commit { parent: None }`   | not supported (root commit, no parent to step back to) |
//! | `Amend`                     | `reset --hard old_sha` — recovers the pre-amend commit |
//! | `CheckoutBranch`            | `checkout_branch(from)`                              |
//! | `CheckoutCommit`            | `checkout_branch(from)` (or `checkout_commit(from)` if `from` was a SHA) |
//! | `Reset`                     | `reset_to_commit(from_sha, original_mode)` — same mode reverses the same way |
//! | `CherryPick` / `Revert`     | `reset --hard HEAD~1` — drops the synthesised commit |
//! | `Merge`                     | `reset --hard pre_merge_sha`                         |
//! | `StashPush`                 | `stash_pop` — re-applies what we just stashed        |
//! | `StashPop`                  | not supported in sub-PR 2 — re-stashing safely needs a heavier index/worktree snapshot than libgit2's `stash_save2` provides |
//!
//! # What this module does NOT do
//!
//! - Walk the cursor — that's the IPC layer's job (`commands/undo.rs`).
//! - Record an inverse-of-inverse op — undo moves the cursor; the redo
//!   path uses the same entries.
//! - Validate "is this safe right now?" beyond what libgit2 surfaces — a
//!   `reset --hard` will refuse with a clear error if the working tree
//!   is dirty in the destructive case; we let that error propagate so
//!   the UI can show it.

use std::path::Path;

use crate::backend::BackendError;
use crate::undo_log::{with_record_skipped, OpKind};

use super::common::{git2_err, open_git2};
use super::worktree;

/// Outcome of a single `apply_inverse` call. The IPC layer turns
/// `Untrackable` into a "couldn't undo" toast without crashing.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub enum UndoOutcome {
    /// Inverse executed; cursor should advance backward.
    Applied { kind_label: String },
    /// Op exists in the log but cannot be inverted in the current state
    /// (root commit, stash-pop in sub-PR 2, etc). Cursor stays where it
    /// was so the user can move past this entry manually if they want.
    Untrackable { reason: String },
}

/// Apply the inverse of `op` against `repo_path`. Errors propagate as
/// `BackendError` so the UI can surface them through its standard
/// notification channel.
///
/// The whole match runs inside [`with_record_skipped`] so the public op
/// wrappers we delegate to (`checkout_branch`, `reset_to_commit`, …)
/// don't append fresh log entries — undo moves the cursor backwards,
/// it doesn't synthesise a "undo of X" record.
pub fn apply_inverse(repo_path: &Path, op: &OpKind) -> Result<UndoOutcome, BackendError> {
    with_record_skipped(|| apply_inverse_inner(repo_path, op))
}

fn apply_inverse_inner(repo_path: &Path, op: &OpKind) -> Result<UndoOutcome, BackendError> {
    match op {
        OpKind::Commit {
            parent_sha: Some(parent_sha),
            ..
        } => {
            soft_reset(repo_path, parent_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "commit".into(),
            })
        }
        OpKind::Commit {
            parent_sha: None, ..
        } => Ok(UndoOutcome::Untrackable {
            reason: "root commit cannot be undone".into(),
        }),
        OpKind::Amend { old_sha, .. } => {
            hard_reset(repo_path, old_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "amend".into(),
            })
        }
        OpKind::CheckoutBranch { from, .. } => {
            worktree::checkout_branch(repo_path, from)?;
            Ok(UndoOutcome::Applied {
                kind_label: "checkout".into(),
            })
        }
        OpKind::CheckoutCommit { from, .. } => {
            // `from` may be a branch shorthand or a 40-char SHA — try
            // branch first, fall back to commit checkout. Detached HEADs
            // round-trip as the SHA string.
            match worktree::checkout_branch(repo_path, from) {
                Ok(()) => Ok(UndoOutcome::Applied {
                    kind_label: "checkout".into(),
                }),
                Err(BackendError::BranchNotFound { .. }) => {
                    worktree::checkout_commit(repo_path, from)?;
                    Ok(UndoOutcome::Applied {
                        kind_label: "checkout".into(),
                    })
                }
                Err(e) => Err(e),
            }
        }
        OpKind::Reset { from_sha, mode, .. } => {
            // Reset with the same mode against the original from-sha
            // perfectly inverts the original reset. Note: we go through
            // the public `reset_to_commit` helper so the inverse itself
            // appends a new log entry — that means consecutive undos of
            // a reset will keep stepping back through history.
            // Acceptable for sub-PR 2; the cursor logic in commands/undo.rs
            // handles the bookkeeping.
            worktree::reset_to_commit(repo_path, from_sha, *mode)?;
            Ok(UndoOutcome::Applied {
                kind_label: "reset".into(),
            })
        }
        OpKind::CherryPick { .. } | OpKind::Revert { .. } => {
            head_minus_one_hard(repo_path)?;
            Ok(UndoOutcome::Applied {
                kind_label: if matches!(op, OpKind::CherryPick { .. }) {
                    "cherry-pick".into()
                } else {
                    "revert".into()
                },
            })
        }
        OpKind::Merge { pre_merge_sha, .. } => {
            hard_reset(repo_path, pre_merge_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "merge".into(),
            })
        }
        OpKind::StashPush { .. } => {
            worktree::stash_pop(repo_path)?;
            Ok(UndoOutcome::Applied {
                kind_label: "stash push".into(),
            })
        }
        OpKind::StashPop { .. } => Ok(UndoOutcome::Untrackable {
            reason: "stash pop undo not supported yet".into(),
        }),
    }
}

fn soft_reset(repo_path: &Path, sha: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let oid = git2::Oid::from_str(sha).map_err(|_| BackendError::CommitNotFound {
        sha: sha.to_string(),
    })?;
    let obj = repo
        .find_object(oid, None)
        .map_err(|_| BackendError::CommitNotFound {
            sha: sha.to_string(),
        })?;
    repo.reset(&obj, git2::ResetType::Soft, None)
        .map_err(git2_err)?;
    Ok(())
}

fn hard_reset(repo_path: &Path, sha: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let oid = git2::Oid::from_str(sha).map_err(|_| BackendError::CommitNotFound {
        sha: sha.to_string(),
    })?;
    let obj = repo
        .find_object(oid, None)
        .map_err(|_| BackendError::CommitNotFound {
            sha: sha.to_string(),
        })?;
    repo.reset(&obj, git2::ResetType::Hard, None)
        .map_err(git2_err)?;
    Ok(())
}

fn head_minus_one_hard(repo_path: &Path) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let head = repo.head().map_err(git2_err)?;
    let head_commit = head.peel_to_commit().map_err(git2_err)?;
    let parent = head_commit.parent(0).map_err(git2_err)?;
    let obj = repo.find_object(parent.id(), None).map_err(git2_err)?;
    repo.reset(&obj, git2::ResetType::Hard, None)
        .map_err(git2_err)?;
    Ok(())
}

/// Re-apply `op` after an undo (sub-PR 3 of #130). Mirrors `apply_inverse`
/// but going forward: for any commit-creating op (Commit / Amend /
/// CherryPick / Revert / Merge) the synthesised commit still lives in
/// the reflog (and on disk), so a single `reset --hard <new_sha>` is
/// enough to restore HEAD without reconstructing the tree. Checkout /
/// reset / stash variants delegate to the public worktree helpers,
/// silenced by `with_record_skipped` so the redo doesn't ghost-record.
pub fn apply_redo(repo_path: &Path, op: &OpKind) -> Result<UndoOutcome, BackendError> {
    with_record_skipped(|| apply_redo_inner(repo_path, op))
}

fn apply_redo_inner(repo_path: &Path, op: &OpKind) -> Result<UndoOutcome, BackendError> {
    match op {
        OpKind::Commit { sha, .. } => {
            hard_reset(repo_path, sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "commit".into(),
            })
        }
        OpKind::Amend { new_sha, .. } => {
            hard_reset(repo_path, new_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "amend".into(),
            })
        }
        OpKind::CheckoutBranch { to, .. } => {
            worktree::checkout_branch(repo_path, to)?;
            Ok(UndoOutcome::Applied {
                kind_label: "checkout".into(),
            })
        }
        OpKind::CheckoutCommit { to_sha, .. } => {
            worktree::checkout_commit(repo_path, to_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "checkout".into(),
            })
        }
        OpKind::Reset { mode, to_sha, .. } => {
            worktree::reset_to_commit(repo_path, to_sha, *mode)?;
            Ok(UndoOutcome::Applied {
                kind_label: "reset".into(),
            })
        }
        OpKind::CherryPick { new_sha, .. } => {
            hard_reset(repo_path, new_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "cherry-pick".into(),
            })
        }
        OpKind::Revert { new_sha, .. } => {
            hard_reset(repo_path, new_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "revert".into(),
            })
        }
        OpKind::Merge { post_merge_sha, .. } => {
            hard_reset(repo_path, post_merge_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "merge".into(),
            })
        }
        OpKind::StashPush { .. } => {
            // Re-stashing the current working tree captures whatever's
            // there now — assumed identical to the pre-undo state since
            // the user just popped it back. Producing a different stash
            // SHA than the original is fine: the cursor walk doesn't
            // care about SHA equality.
            // Undo reversal — keep pre-#12 behavior (untracked
            // included, ignored excluded). The recorded op didn't
            // carry per-flag history so reverse uses sane defaults.
            worktree::stash_push(repo_path, None, true, false)?;
            Ok(UndoOutcome::Applied {
                kind_label: "stash push".into(),
            })
        }
        OpKind::StashPop { .. } => Ok(UndoOutcome::Untrackable {
            reason: "stash pop redo not supported (symmetric with undo)".into(),
        }),
    }
}
