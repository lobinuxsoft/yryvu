// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{GitBackend, TagInfo};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn create_tag(
    repo_path: String,
    name: String,
    sha: String,
    message: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .create_tag(&PathBuf::from(&repo_path), &name, &sha, message.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_tag(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .delete_tag(&PathBuf::from(&repo_path), &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn annotate_tag(repo_path: String, name: String, message: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .annotate_tag(&PathBuf::from(&repo_path), &name, &message)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn push_tag(repo_path: String, remote: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .push_tag(&PathBuf::from(&repo_path), &remote, &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_tag_remote(
    repo_path: String,
    remote: String,
    name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .delete_tag_remote(&PathBuf::from(&repo_path), &remote, &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_tags(repo_path: String) -> Result<Vec<TagInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .list_tags(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
