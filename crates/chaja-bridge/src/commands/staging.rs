// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{CommitOptions, FileDiff, GitBackend, WorkingTreeStatus};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn working_tree_status(repo_path: String) -> Result<WorkingTreeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .working_tree_status(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stage_files(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .stage_files(&PathBuf::from(&repo_path), &paths)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn unstage_files(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .unstage_files(&PathBuf::from(&repo_path), &paths)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn diff_unstaged(repo_path: String, path: String) -> Result<FileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .diff_unstaged(&PathBuf::from(&repo_path), &path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn diff_staged(repo_path: String, path: String) -> Result<FileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .diff_staged(&PathBuf::from(&repo_path), &path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn commit_staged(repo_path: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .commit_staged(&PathBuf::from(&repo_path), &message)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn amend_commit(repo_path: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .amend_commit(&PathBuf::from(&repo_path), &message)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn head_commit_message(repo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .head_commit_message(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stage_all(repo_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .stage_all(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn unstage_all(repo_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .unstage_all(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn discard_paths(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .discard_paths(&PathBuf::from(&repo_path), &paths)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_commit(repo_path: String, options: CommitOptions) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .create_commit(&PathBuf::from(&repo_path), &options)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn commit_and_push(repo_path: String, options: CommitOptions) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .commit_and_push(&PathBuf::from(&repo_path), &options)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
