// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{GitBackend, RepoStateInfo};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn is_working_tree_dirty(repo_path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .is_working_tree_dirty(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn checkout_branch(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .checkout_branch(&PathBuf::from(&repo_path), &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stash_push(repo_path: String, message: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .stash_push(&PathBuf::from(&repo_path), message.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stash_pop(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .stash_pop(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stash_count(repo_path: String) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .stash_count(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn abort_merge(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .abort_merge(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_state(repo_path: String) -> Result<RepoStateInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .repo_state(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
