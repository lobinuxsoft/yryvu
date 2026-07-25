// SPDX-License-Identifier: AGPL-3.0-or-later

//! Pieces shared by the undo and redo directions: the outcome type, the
//! dirty-tree guard, and the low-level soft/hard reset helpers.

use std::path::Path;

use crate::backend::BackendError;
use crate::repo::common::{git2_err, open_git2};
use crate::repo::worktree;

/// Outcome of a single `apply_inverse` / `apply_redo` call. The IPC layer
/// turns `Untrackable` into a "couldn't undo" toast without crashing.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub enum UndoOutcome {
    /// Inverse executed; cursor should advance backward.
    ///
    /// `discarded_dirty` is true when the user answered the dirty dialog
    /// with "discard" and there really was uncommitted work to lose. The
    /// UI needs it to stop implying the trip is round (#475).
    Applied {
        kind_label: String,
        discarded_dirty: bool,
    },
    /// Op exists in the log but cannot be inverted in the current state
    /// (root commit, stash-pop in sub-PR 2, etc). Cursor stays where it
    /// was so the user can move past this entry manually if they want.
    Untrackable { reason: String },
}

impl UndoOutcome {
    /// `Applied` with no work lost — the common case. The forced-over-
    /// dirty path re-stamps the flag once, in `apply_inverse` /
    /// `apply_redo`, where the answer is actually known.
    pub(super) fn applied(kind_label: &str) -> Self {
        UndoOutcome::Applied {
            kind_label: kind_label.into(),
            discarded_dirty: false,
        }
    }

    pub(super) fn with_discarded_dirty(self, discarded: bool) -> Self {
        match self {
            UndoOutcome::Applied { kind_label, .. } => UndoOutcome::Applied {
                kind_label,
                discarded_dirty: discarded,
            },
            other => other,
        }
    }
}

/// Shared fallback so the `Untrackable` arms and their `OpKind` predicate
/// can never drift into disagreeing about the reason.
pub(super) fn untrackable(reason: Option<&'static str>) -> UndoOutcome {
    UndoOutcome::Untrackable {
        reason: reason.unwrap_or("operation cannot be reversed").into(),
    }
}

/// Refuse a destructive undo/redo over a dirty tree unless `force` says the
/// user was asked and accepted. `reset --hard` never refuses on its own
/// (libgit2 `reset.c` forces `GIT_CHECKOUT_FORCE` regardless of caller
/// options), so this is the only thing standing between a reflex Ctrl+Z and
/// the user's uncommitted work.
///
/// Returns whether uncommitted work is about to be destroyed — `force`
/// over a tree that really was dirty. A forced call on a clean tree costs
/// nothing and must not be reported as a loss.
pub(super) fn guard_dirty(
    repo_path: &Path,
    destructive: bool,
    force: bool,
) -> Result<bool, BackendError> {
    if !destructive {
        return Ok(false);
    }
    if force {
        // The user was already asked and accepted. The scan is now only
        // asking *how much* it cost, so a failure must not turn a
        // confirmed undo into an error — before this returned a bool the
        // `force` case never ran the scan at all, and regressing that
        // would break "Discard & Undo" over an unrelated status error.
        // Worst case of the fallback is a missing caveat in a tooltip.
        return Ok(worktree::is_working_tree_dirty(repo_path).unwrap_or(false));
    }
    if worktree::is_working_tree_dirty(repo_path)? {
        return Err(BackendError::WorkingTreeDirty);
    }
    Ok(false)
}

pub(super) fn soft_reset(repo_path: &Path, sha: &str) -> Result<(), BackendError> {
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

pub(super) fn hard_reset(repo_path: &Path, sha: &str) -> Result<(), BackendError> {
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
