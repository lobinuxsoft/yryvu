// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::backend::{GitBackend, SubmoduleInfo};
use crate::preferences;
use crate::repo::{submodules, GixBackend};

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

/// Resolve a gitlink OID's commit summary inside the submodule's repo —
/// backs the diff pointer pane (issue #60). `None` when uncheckout-out or
/// the commit isn't fetched.
#[tauri::command]
pub async fn submodule_commit_summary(
    repo_path: String,
    submodule_path: String,
    sha: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        submodules::submodule_commit_summary(&PathBuf::from(&repo_path), &submodule_path, &sha)
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

/// Per-repo "Keep submodules up to date" override: "default" |
/// "enabled" | "disabled" (GK tri-state, stored in the repo's
/// `.git/config` under `[yryvu] submoduleAutoUpdate`).
#[tauri::command]
pub async fn get_submodule_auto_update(repo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        submodules::auto_update_setting(&PathBuf::from(&repo_path)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_submodule_auto_update(repo_path: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        submodules::set_auto_update_setting(&PathBuf::from(&repo_path), &value)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Post-op hook (#98): resolve the tri-state against the global
/// preference and, when enabled, run `git submodule update --init
/// --recursive`. Returns whether an update actually ran so the caller
/// knows to refresh the working tree. Resolution happens entirely
/// backend-side — the renderer never combines settings.
#[tauri::command]
pub async fn submodule_auto_update(app: AppHandle, repo_path: String) -> Result<bool, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let global = preferences::load(&dir)
            .map(|p| p.submodules.auto_update_default)
            .map_err(|e| e.to_string())?;
        let repo_setting = submodules::auto_update_setting(&path).map_err(|e| e.to_string())?;
        if !submodules::resolve_auto_update(&repo_setting, global) {
            return Ok(false);
        }
        submodules::auto_update_all(&path).map_err(|e| e.to_string())
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
