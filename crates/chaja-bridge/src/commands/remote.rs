// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::GitBackend;
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
