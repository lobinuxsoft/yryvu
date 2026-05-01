// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{GitBackend, MergeResult, MergeStrategy, PushOptions};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn delete_remote_branch(
    repo_path: String,
    remote: String,
    name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .delete_remote_branch(&PathBuf::from(&repo_path), &remote, &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fetch_prune(repo_path: String, remote: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .fetch_prune(&PathBuf::from(&repo_path), remote.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_remote_url(repo_path: String, remote_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .get_remote_url(&PathBuf::from(&repo_path), &remote_name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn push(repo_path: String, options: Option<PushOptions>) -> Result<(), String> {
    let opts = options.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .push(&PathBuf::from(&repo_path), opts)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pull(
    repo_path: String,
    remote: Option<String>,
    strategy: MergeStrategy,
) -> Result<MergeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .pull(&PathBuf::from(&repo_path), remote.as_deref(), strategy)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn force_pull(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .force_pull(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
