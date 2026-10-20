// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use tauri::AppHandle;

use crate::integrations::{self, AuthData, UserInfo};

use super::sidecar_path;

#[tauri::command]
pub async fn save_integration_token(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    token: String,
    hostname: Option<String>,
) -> Result<(), String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::save_integration(
            &path as &Path,
            profile_id.as_deref(),
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
    profile_id: Option<String>,
    integration_type: String,
) -> Result<Option<AuthData>, String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::get_integration(&path as &Path, profile_id.as_deref(), &integration_type)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_integration_token(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
) -> Result<(), String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::remove_integration(&path as &Path, profile_id.as_deref(), &integration_type)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_configured_integrations(
    app: AppHandle,
    profile_id: Option<String>,
) -> Result<Vec<String>, String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::list_configured(&path as &Path, profile_id.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_integration_hostname(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    hostname: String,
) -> Result<(), String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::set_hostname(
            &path as &Path,
            profile_id.as_deref(),
            &integration_type,
            &hostname,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_integration_hostname(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
) -> Result<Option<String>, String> {
    let path = sidecar_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        integrations::get_hostname(&path as &Path, profile_id.as_deref(), &integration_type)
            .map_err(|e| e.to_string())
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

/// What the UI may know about a custom OAuth App. The secret never
/// leaves the keyring.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomOAuthAppInfo {
    pub client_id: String,
}

#[tauri::command]
pub async fn save_custom_oauth_app(
    integration_type: String,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    let (client_id, client_secret) = (
        client_id.trim().to_string(),
        client_secret.trim().to_string(),
    );
    if client_id.is_empty() || client_secret.is_empty() {
        return Err("Client ID and client secret are both required".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        integrations::save_oauth_app(
            &integration_type,
            &integrations::CustomOAuthApp {
                client_id,
                client_secret,
            },
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_custom_oauth_app(
    integration_type: String,
) -> Result<Option<CustomOAuthAppInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        integrations::get_oauth_app(&integration_type)
            .map(|app| {
                app.map(|a| CustomOAuthAppInfo {
                    client_id: a.client_id,
                })
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_custom_oauth_app(integration_type: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        integrations::remove_oauth_app(&integration_type).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
