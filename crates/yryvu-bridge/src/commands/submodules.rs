// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{GitBackend, SubmoduleInfo};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn list_submodules(repo_path: String) -> Result<Vec<SubmoduleInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .list_submodules(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn submodule_init(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .submodule_init(&PathBuf::from(&repo_path), &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn submodule_update(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .submodule_update(&PathBuf::from(&repo_path), &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn submodule_add(
    repo_path: String,
    url: String,
    target_path: String,
    branch: Option<String>,
    name: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .submodule_add(
                &PathBuf::from(&repo_path),
                &url,
                &PathBuf::from(&target_path),
                branch.as_deref(),
                name.as_deref(),
            )
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn submodule_sync(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .submodule_sync(&PathBuf::from(&repo_path), &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn submodule_reset(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .submodule_reset(&PathBuf::from(&repo_path), &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn submodule_deinit(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .submodule_deinit(&PathBuf::from(&repo_path), &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn submodule_remove(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .submodule_remove(&PathBuf::from(&repo_path), &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
