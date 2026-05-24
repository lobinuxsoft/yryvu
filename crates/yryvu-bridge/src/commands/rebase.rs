// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::GitBackend;
use crate::repo::rebase::interactive::{CommitSummary, RebasePlan, RebaseState};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn list_commits_for_rebase(
    repo_path: String,
    upstream: String,
) -> Result<Vec<CommitSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .list_commits_for_rebase(&PathBuf::from(&repo_path), &upstream)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn begin_interactive_rebase(
    repo_path: String,
    plan: RebasePlan,
) -> Result<RebaseState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .begin_interactive_rebase(&PathBuf::from(&repo_path), plan)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn continue_interactive_rebase(repo_path: String) -> Result<RebaseState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .continue_interactive_rebase(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skip_interactive_rebase_step(repo_path: String) -> Result<RebaseState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .skip_interactive_rebase_step(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn abort_interactive_rebase(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .abort_interactive_rebase(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_interactive_rebase_state(
    repo_path: String,
) -> Result<Option<RebaseState>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .get_interactive_rebase_state(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
