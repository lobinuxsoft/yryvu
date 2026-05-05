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

use serde::Serialize;

use crate::repo::undo::{apply_inverse, apply_redo, UndoOutcome};
use crate::undo_log::{read_log, set_cursor};

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
    pub can_redo: bool,
    pub redo_label: Option<String>,
    pub redo_count: u32,
}

#[tauri::command]
pub async fn get_undo_redo_state(repo_path: String) -> Result<UndoRedoState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let log = read_log(&PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
        let cursor = log.cursor;
        let total = log.ops.len();
        let undo_label = cursor
            .and_then(|c| log.ops.get(c))
            .map(|op| op.kind.human_label());
        // The redo entry sits at cursor + 1 — or at index 0 when the
        // user has fully undone past the start (cursor = None) and the
        // log still has an entry available.
        let redo_idx = match cursor {
            Some(c) => Some(c + 1),
            None if !log.ops.is_empty() => Some(0),
            None => None,
        };
        let redo_label = redo_idx
            .and_then(|i| log.ops.get(i))
            .map(|op| op.kind.human_label());
        // Counts: cursor = N means the next undo lands at N (N+1 ops
        // are reachable backwards). When cursor is None we've undone
        // past the start, so undo_count = 0 and redo_count = full log.
        let undo_count = cursor.map(|c| c + 1).unwrap_or(0);
        let redo_count = total.saturating_sub(undo_count);
        Ok::<_, String>(UndoRedoState {
            can_undo: undo_label.is_some(),
            undo_label,
            undo_count: u32::try_from(undo_count).unwrap_or(u32::MAX),
            can_redo: redo_label.is_some(),
            redo_label,
            redo_count: u32::try_from(redo_count).unwrap_or(u32::MAX),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn undo_last_operation(repo_path: String) -> Result<UndoOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let log = read_log(&path).map_err(|e| e.to_string())?;
        let cursor = log.cursor.ok_or_else(|| "nothing to undo".to_string())?;
        let op = log
            .ops
            .get(cursor)
            .ok_or_else(|| "undo log corrupted: cursor out of range".to_string())?
            .kind
            .clone();
        let outcome = apply_inverse(&path, &op).map_err(|e| e.to_string())?;
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
pub async fn redo_last_undo(repo_path: String) -> Result<UndoOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
        let outcome = apply_redo(&path, &op).map_err(|e| e.to_string())?;
        if matches!(outcome, UndoOutcome::Applied { .. }) {
            set_cursor(&path, Some(target_idx)).map_err(|e| e.to_string())?;
        }
        Ok::<_, String>(outcome)
    })
    .await
    .map_err(|e| e.to_string())?
}
