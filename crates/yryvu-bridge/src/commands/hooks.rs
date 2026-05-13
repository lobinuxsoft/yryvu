// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for Git hooks (issue #192).

use std::path::PathBuf;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::repo::hooks::{
    hook_script_path, list_hooks as list_hooks_impl, set_hook_enabled as set_hook_enabled_impl,
    HookEntry,
};

#[tauri::command]
pub async fn list_hooks(repo_path: String) -> Result<Vec<HookEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_hooks_impl(&PathBuf::from(repo_path)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_hook_enabled(
    repo_path: String,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_hook_enabled_impl(&PathBuf::from(repo_path), &name, enabled)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Resolve the on-disk script path for `name` (active or disabled) and
/// hand it to the OS default opener. The user's preferred editor for
/// shell scripts handles the rest — yryvu doesn't ship its own editor.
#[tauri::command]
pub async fn open_hook_script(
    app: AppHandle,
    repo_path: String,
    name: String,
) -> Result<(), String> {
    let path: PathBuf = tauri::async_runtime::spawn_blocking(move || {
        hook_script_path(&PathBuf::from(repo_path), &name)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}
