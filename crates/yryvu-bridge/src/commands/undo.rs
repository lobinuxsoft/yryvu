// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for the undo / redo toolbar (issue #130, sub-PR 2).
//!
//! Two surfaces:
//!
//! - [`undo_last_operation`] — pops the most-recent op off the sidecar
//!   cursor, runs its inverse via [`crate::repo::undo::apply_inverse`],
//!   and decrements the cursor on a successful apply.
//! - [`get_undo_redo_state`] — cheap sidecar inspection that drives the
//!   toolbar's `Undo` / `Redo` button enablement and tooltips.
//!
//! Sub-PR 3 will add `redo_last_undo` here.

use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, MutexGuard};

use serde::Serialize;

use crate::repo::undo::{apply_inverse, apply_redo, UndoOutcome};
use crate::undo_log::{mark_discarded_dirty_best_effort, read_log, set_cursor};

/// Serializes the whole read→apply→set_cursor sequence of every undo /
/// redo invocation. The sidecar is a read-modify-write file with no lock
/// of its own (`write_log` is last-rename-wins), so two overlapping calls
/// both read the same `cursor` and each run the inverse of the same op.
/// For HEAD-relative inverses (cherry-pick / revert reset to `HEAD~1`)
/// that silently drops one extra commit per overlap while the cursor steps
/// back once (#472).
///
/// A single process-wide mutex is enough: undo / redo is a human-driven
/// action, never a hot path, and serializing two *different* repos is a
/// benign non-event. It also closes the multi-window case the frontend
/// in-flight guard can't see.
static UNDO_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Acquire [`UNDO_MUTEX`], recovering from poisoning. The guarded value is
/// `()` and the sidecar writes atomically, so a prior panic left no
/// half-written invariant — refusing every future undo over a poison flag
/// would be strictly worse than proceeding.
fn undo_lock() -> MutexGuard<'static, ()> {
    UNDO_MUTEX.lock().unwrap_or_else(|e| e.into_inner())
}

/// Snapshot of the toolbar's undo / redo state. Re-fetched by the
/// frontend on every `undoRedoNonce` bump and on initial repo open.
///
/// `undo_count` / `redo_count` drive the toolbar buttons' badges. Sum
/// always equals `ops.len()` — the cursor cuts the queue into "behind"
/// and "ahead" halves, which are exactly what Undo and Redo each have
/// available to apply.
#[derive(Debug, Clone, Serialize)]
pub struct UndoRedoState {
    pub can_undo: bool,
    pub undo_label: Option<String>,
    pub undo_count: u32,
    /// The entry Undo would apply cost uncommitted work when it ran, and
    /// reversing it will not bring that work back (#475).
    pub undo_lost_work: bool,
    pub can_redo: bool,
    pub redo_label: Option<String>,
    pub redo_count: u32,
    /// Same, for the entry Redo would apply.
    pub redo_lost_work: bool,
}

#[tauri::command]
pub async fn get_undo_redo_state(repo_path: String) -> Result<UndoRedoState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let log = read_log(&PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
        let cursor = log.cursor;
        let total = log.ops.len();
        let undo_entry = cursor.and_then(|c| log.ops.get(c));
        let undo_label = undo_entry.map(|op| op.kind.human_label());
        // The redo entry sits at cursor + 1 — or at index 0 when the
        // user has fully undone past the start (cursor = None) and the
        // log still has an entry available.
        let redo_idx = match cursor {
            Some(c) => Some(c + 1),
            None if !log.ops.is_empty() => Some(0),
            None => None,
        };
        let redo_entry = redo_idx.and_then(|i| log.ops.get(i));
        let redo_label = redo_entry.map(|op| op.kind.human_label());
        // Counts: cursor = N means the next undo lands at N (N+1 ops
        // are reachable backwards). When cursor is None we've undone
        // past the start, so undo_count = 0 and redo_count = full log.
        let undo_count = cursor.map(|c| c + 1).unwrap_or(0);
        let redo_count = total.saturating_sub(undo_count);
        // Enablement asks whether the entry can actually be reversed, not
        // merely whether it exists. A root commit or a stash pop returns
        // `Untrackable`, which leaves the cursor put — so a presence-only
        // check lights the button up forever on an op that will never
        // move (#474).
        let can_undo = undo_entry.is_some_and(|op| op.kind.undo_untrackable_reason().is_none());
        let can_redo = redo_entry.is_some_and(|op| op.kind.redo_untrackable_reason().is_none());
        Ok::<_, String>(UndoRedoState {
            can_undo,
            undo_label,
            undo_count: u32::try_from(undo_count).unwrap_or(u32::MAX),
            undo_lost_work: undo_entry.is_some_and(|op| op.discarded_dirty),
            can_redo,
            redo_label,
            redo_count: u32::try_from(redo_count).unwrap_or(u32::MAX),
            redo_lost_work: redo_entry.is_some_and(|op| op.discarded_dirty),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn undo_last_operation(
    repo_path: String,
    force: Option<bool>,
) -> Result<UndoOutcome, String> {
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = undo_lock();
        let path = PathBuf::from(&repo_path);
        let log = read_log(&path).map_err(|e| e.to_string())?;
        let cursor = log.cursor.ok_or_else(|| "nothing to undo".to_string())?;
        let op = log
            .ops
            .get(cursor)
            .ok_or_else(|| "undo log corrupted: cursor out of range".to_string())?
            .kind
            .clone();
        let outcome = apply_inverse(&path, &op, force).map_err(|e| e.to_string())?;
        // Flag the entry the user just paid for, so its redo tooltip can
        // stop implying the trip is round (#475). Same entry either
        // direction: the loss belongs to the op, not to the arrow.
        if matches!(
            outcome,
            UndoOutcome::Applied {
                discarded_dirty: true,
                ..
            }
        ) {
            mark_discarded_dirty_best_effort(&path, cursor);
        }
        if matches!(outcome, UndoOutcome::Applied { .. }) {
            // Walk the cursor back. Going past index 0 sets cursor to
            // None — the log is logically empty from undo's POV until
            // the user redoes something forward.
            let next = if cursor == 0 { None } else { Some(cursor - 1) };
            set_cursor(&path, next).map_err(|e| e.to_string())?;
        }
        Ok::<_, String>(outcome)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn redo_last_undo(repo_path: String, force: Option<bool>) -> Result<UndoOutcome, String> {
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = undo_lock();
        let path = PathBuf::from(&repo_path);
        let log = read_log(&path).map_err(|e| e.to_string())?;
        // Redo target sits at cursor + 1 (or index 0 when the user has
        // fully undone past the start and the log still has entries).
        let target_idx = match log.cursor {
            Some(c) => c + 1,
            None if !log.ops.is_empty() => 0,
            None => return Err("nothing to redo".to_string()),
        };
        let op = log
            .ops
            .get(target_idx)
            .ok_or_else(|| "nothing to redo".to_string())?
            .kind
            .clone();
        let outcome = apply_redo(&path, &op, force).map_err(|e| e.to_string())?;
        if matches!(
            outcome,
            UndoOutcome::Applied {
                discarded_dirty: true,
                ..
            }
        ) {
            mark_discarded_dirty_best_effort(&path, target_idx);
        }
        if matches!(outcome, UndoOutcome::Applied { .. }) {
            set_cursor(&path, Some(target_idx)).map_err(|e| e.to_string())?;
        }
        Ok::<_, String>(outcome)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn undo_lock_recovers_from_poison() {
        // Panic while holding the mutex to poison it.
        let _ = std::panic::catch_unwind(|| {
            let _held = UNDO_MUTEX.lock().unwrap();
            panic!("poison the undo mutex");
        });
        assert!(UNDO_MUTEX.is_poisoned());
        // undo_lock must still hand out the guard — refusing every future
        // undo over a stale poison flag would be strictly worse.
        let _guard = undo_lock();
    }
}
