// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{BlameLine, FileBlame, FileHistoryEntry};
use crate::repo::blame::file_blame as blame_impl;
use crate::repo::checkout_file::checkout_file_at as checkout_impl;
use crate::repo::file_history::file_history as history_impl;

/// Per-file history with rename-following (issue #7). Bounded by `max`
/// (default 1000) so the frontend's virtualization budget stays
/// predictable on deep histories.
#[tauri::command]
pub async fn file_history(
    repo_path: String,
    path: String,
    max: Option<usize>,
) -> Result<Vec<FileHistoryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        history_impl(&PathBuf::from(&repo_path), &path, max).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Per-line blame for `path` at `sha` (defaults to HEAD when `None`).
/// Issue #8.
#[tauri::command]
pub async fn file_blame(
    repo_path: String,
    path: String,
    sha: Option<String>,
) -> Result<FileBlame, String> {
    tauri::async_runtime::spawn_blocking(move || {
        blame_impl(&PathBuf::from(&repo_path), &path, sha.as_deref()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Restore `path` to its state at `sha` (working tree + index).
/// Destructive — caller MUST confirm.
#[tauri::command]
pub async fn checkout_file_at(repo_path: String, path: String, sha: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        checkout_impl(&PathBuf::from(&repo_path), &path, &sha).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// Suppress unused-import warning in non-test builds.
#[allow(dead_code)]
fn _ensure_blame_line_referenced() -> Option<BlameLine> {
    None
}
