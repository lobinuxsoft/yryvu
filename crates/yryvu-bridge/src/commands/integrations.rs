// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for integration credential persistence (#252).
//! Surface mirrors the frontend's existing signal-only API
//! (\`tokenStorage.ts\` + \`selfHostedHostnames.ts\`) so the swap is a
//! drop-in.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::integrations::{self, oauth, AuthData, UserInfo};

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

/// Returned by [`oauth_begin`]. The frontend opens `authorize_url` in
/// the user's browser via `tauri-plugin-opener` and persists
/// `session_id` so [`oauth_await`] can pick the session up again.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthBeginResult {
    pub session_id: String,
    pub authorize_url: String,
}

/// Phase 1 of the OAuth flow: build the authorize URL for `integration_type`,
/// stage the [`OAuthSession`] in the registry, and return both the URL
/// and an opaque `session_id` to the frontend.
///
/// [`OAuthSession`]: crate::integrations::oauth::OAuthSession
#[tauri::command]
pub async fn oauth_begin(integration_type: String) -> Result<OAuthBeginResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (session, authorize_url) =
            oauth::flow::begin(&integration_type).map_err(|e| e.to_string())?;
        // 128-bit base64 random — opaque to the frontend, decoupled
        // from the CSRF token that already lives in the URL's `state`.
        let session_id = oauth2::CsrfToken::new_random().secret().to_string();
        oauth::state::insert(session_id.clone(), session);
        Ok(OAuthBeginResult {
            session_id,
            authorize_url,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Phase 2 of the OAuth flow: take the parked session by `session_id`,
/// block on the loopback redirect (default 5-min window), and exchange
/// the authorization code for an access token. The token is returned
/// raw — the frontend pipes it through `saveToken` (preflight + persist).
#[tauri::command]
pub async fn oauth_await(session_id: String) -> Result<String, String> {
    let session = oauth::state::take(&session_id)
        .ok_or_else(|| "OAuth session not found (already consumed or cancelled)".to_string())?;
    oauth::flow::await_completion(session, oauth::flow::DEFAULT_FLOW_TIMEOUT)
        .await
        .map_err(|e| e.to_string())
}

/// Drop a parked OAuth session by `session_id` without consuming it.
/// Used when the user dismisses the connect dialog before the browser
/// round-trip completes. Releases the bound loopback port.
#[tauri::command]
pub async fn oauth_cancel(session_id: String) -> Result<(), String> {
    oauth::state::drop_session(&session_id);
    Ok(())
}
