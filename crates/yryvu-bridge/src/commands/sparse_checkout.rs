// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for sparse checkout (issue #309).

use std::path::PathBuf;

use crate::repo::sparse_checkout::{
    apply_disable as apply_disable_impl, apply_init as apply_init_impl,
    apply_reapply as apply_reapply_impl, apply_set as apply_set_impl, read_state,
    SparseCheckoutState,
};

#[tauri::command]
pub async fn get_sparse_checkout_state(repo_path: String) -> Result<SparseCheckoutState, String> {
    tauri::async_runtime::spawn_blocking(move || read_state(&PathBuf::from(repo_path)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sparse_init(repo_path: String, cone_mode: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_init_impl(&PathBuf::from(repo_path), cone_mode)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sparse_set_patterns(
    repo_path: String,
    cone_mode: bool,
    patterns: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_set_impl(&PathBuf::from(repo_path), cone_mode, &patterns)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sparse_disable(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || apply_disable_impl(&PathBuf::from(repo_path)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sparse_reapply(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || apply_reapply_impl(&PathBuf::from(repo_path)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
