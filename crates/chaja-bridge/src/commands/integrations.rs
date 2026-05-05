// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for integration credential persistence (#252).
//! Surface mirrors the frontend's existing signal-only API
//! (\`tokenStorage.ts\` + \`selfHostedHostnames.ts\`) so the swap is a
//! drop-in.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::integrations::{self, AuthData, UserInfo};

/// Resolve the sidecar JSON path under the app's local data dir. Same
/// shape as the preferences sidecar — kept separate because they have
/// different schemas + lifecycles.
fn sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("integrations.json"))
}

#[tauri::command]
pub async fn save_integration_token(
    app: AppHandle,
    integration_type: String,
    token: String,
    hostname: Option<String>,
) -> Result<(), String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::save_integration(
            &path as &Path,
            &integration_type,
            &token,
            hostname.as_deref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_integration_token(
    app: AppHandle,
    integration_type: String,
) -> Result<Option<AuthData>, String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::get_integration(&path as &Path, &integration_type).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_integration_token(
    app: AppHandle,
    integration_type: String,
) -> Result<(), String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::remove_integration(&path as &Path, &integration_type)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_configured_integrations(app: AppHandle) -> Result<Vec<String>, String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::list_configured(&path as &Path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_integration_hostname(
    app: AppHandle,
    integration_type: String,
    hostname: String,
) -> Result<(), String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::set_hostname(&path as &Path, &integration_type, &hostname)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_integration_hostname(
    app: AppHandle,
    integration_type: String,
) -> Result<Option<String>, String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::get_hostname(&path as &Path, &integration_type).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Validate a token against the provider's API and fetch the
/// authenticated user's profile. Routes by `integration_type` to the
/// appropriate per-provider client. Providers without a client yet
/// return `NotImplemented` — frontend treats that as "skip preflight,
/// stay in mocked connect path".
#[tauri::command]
pub async fn integration_preflight(
    integration_type: String,
    token: String,
    hostname: Option<String>,
) -> Result<UserInfo, String> {
    integrations::preflight(&integration_type, &token, hostname.as_deref())
        .await
        .map_err(|e| e.to_string())
}
