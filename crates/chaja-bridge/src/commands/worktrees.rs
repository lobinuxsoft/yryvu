// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{GitBackend, WorktreeInfo};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .list_worktrees(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn worktree_lock(
    repo_path: String,
    target_workdir: String,
    reason: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .worktree_lock(
                &PathBuf::from(&repo_path),
                &PathBuf::from(&target_workdir),
                reason.as_deref(),
            )
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn worktree_unlock(
    repo_path: String,
    target_workdir: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .worktree_unlock(&PathBuf::from(&repo_path), &PathBuf::from(&target_workdir))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn worktree_remove(
    repo_path: String,
    target_workdir: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .worktree_remove(&PathBuf::from(&repo_path), &PathBuf::from(&target_workdir))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
