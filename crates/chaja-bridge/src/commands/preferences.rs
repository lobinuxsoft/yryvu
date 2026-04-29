// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for the preferences module. Resolve the platform
//! config dir on the backend so the path never leaks to the renderer
//! (the frontend doesn't need it and serializing it would invite
//! brittle path-handling code on the JS side).

use tauri::{AppHandle, Manager};

use crate::preferences::{self, Preferences};

#[tauri::command]
pub async fn get_preferences(app: AppHandle) -> Result<Preferences, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || preferences::load(&dir))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_preferences(
    app: AppHandle,
    preferences: Preferences,
) -> Result<Preferences, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        preferences::save(&dir, &preferences)?;
        Ok::<Preferences, preferences::PreferencesError>(preferences)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_preferences(app: AppHandle) -> Result<Preferences, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || preferences::reset(&dir))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
