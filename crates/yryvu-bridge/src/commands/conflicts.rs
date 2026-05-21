// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::GitBackend;
use crate::repo::conflicts::{ConflictDiff3, ConflictListing, ConflictSide, ConflictSource};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn list_conflicts(repo_path: String) -> Result<ConflictListing, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .list_conflicts(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_conflict_diff3(repo_path: String, path: String) -> Result<ConflictDiff3, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .read_conflict_diff3(&PathBuf::from(&repo_path), &path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn accept_conflict_side(
    repo_path: String,
    path: String,
    side: ConflictSide,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .accept_conflict_side(&PathBuf::from(&repo_path), &path, side)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn resolve_conflict_with_content(
    repo_path: String,
    path: String,
    content: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .resolve_conflict_with_content(&PathBuf::from(&repo_path), &path, &content)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mark_conflict_resolved(repo_path: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .mark_conflict_resolved(&PathBuf::from(&repo_path), &path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn finish_in_progress_op(repo_path: String) -> Result<ConflictSource, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .finish_in_progress_op(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
