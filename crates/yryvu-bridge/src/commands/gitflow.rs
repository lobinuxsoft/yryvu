// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for Git Flow (issue #305).

use std::path::PathBuf;

use crate::repo::gitflow::ops::{self, FinishOutcome};
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

// ---- branch operations (issue #19) ----

/// Run a blocking gitflow op on the worker pool and flatten the
/// join + op errors into a single `String` for IPC.
async fn run_blocking<T, F>(op: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, crate::repo::gitflow::GitflowError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || op().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gitflow_feature_start(repo_path: String, name: String) -> Result<String, String> {
    run_blocking(move || ops::feature_start(&PathBuf::from(repo_path), &name)).await
}

#[tauri::command]
pub async fn gitflow_feature_finish(
    repo_path: String,
    name: String,
    keep_branch: bool,
) -> Result<FinishOutcome, String> {
    run_blocking(move || ops::feature_finish(&PathBuf::from(repo_path), &name, keep_branch)).await
}

#[tauri::command]
pub async fn gitflow_release_start(repo_path: String, version: String) -> Result<String, String> {
    run_blocking(move || ops::release_start(&PathBuf::from(repo_path), &version)).await
}

#[tauri::command]
pub async fn gitflow_release_finish(
    repo_path: String,
    version: String,
    tag_message: String,
    keep_branch: bool,
) -> Result<FinishOutcome, String> {
    run_blocking(move || {
        ops::release_finish(
            &PathBuf::from(repo_path),
            &version,
            &tag_message,
            keep_branch,
        )
    })
    .await
}

#[tauri::command]
pub async fn gitflow_hotfix_start(repo_path: String, version: String) -> Result<String, String> {
    run_blocking(move || ops::hotfix_start(&PathBuf::from(repo_path), &version)).await
}

#[tauri::command]
pub async fn gitflow_hotfix_finish(
    repo_path: String,
    version: String,
    tag_message: String,
    keep_branch: bool,
) -> Result<FinishOutcome, String> {
    run_blocking(move || {
        ops::hotfix_finish(
            &PathBuf::from(repo_path),
            &version,
            &tag_message,
            keep_branch,
        )
    })
    .await
}

#[tauri::command]
pub async fn github_flow_start(
    repo_path: String,
    base: String,
    name: String,
) -> Result<String, String> {
    run_blocking(move || ops::github_flow_start(&PathBuf::from(repo_path), &base, &name)).await
}

#[tauri::command]
pub async fn github_flow_finish(
    repo_path: String,
    base: String,
    name: String,
    keep_branch: bool,
) -> Result<FinishOutcome, String> {
    run_blocking(move || {
        ops::github_flow_finish(&PathBuf::from(repo_path), &base, &name, keep_branch)
    })
    .await
}
