// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for Git Flow (issue #305).

use std::path::PathBuf;

use crate::repo::gitflow::{
    read_gitflow_config as read_impl, write_gitflow_config as write_impl, GitflowConfig,
};

#[tauri::command]
pub async fn read_gitflow_config(repo_path: String) -> Result<Option<GitflowConfig>, String> {
    tauri::async_runtime::spawn_blocking(move || read_impl(&PathBuf::from(repo_path)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_gitflow_config(repo_path: String, config: GitflowConfig) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_impl(&PathBuf::from(repo_path), &config))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn gitflow_defaults() -> Result<GitflowConfig, String> {
    // Sync — no I/O, no spawn_blocking needed. Async signature kept
    // for consistency with the rest of the command surface.
    Ok(GitflowConfig::defaults())
}
