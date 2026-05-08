// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for the theme system. Wraps `loader` with the
//! `Result<T, String>` convention used elsewhere in chaja-bridge
//! (see `commands/preferences.rs`).

use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::themes::loader::{self, ThemeCss, ThemeEntry};

fn custom_themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(loader::themes_dir(&config))
}

#[tauri::command]
pub async fn list_themes(app: AppHandle) -> Result<Vec<ThemeEntry>, String> {
    let dir = custom_themes_dir(&app)?;
    Ok(loader::list_themes(&dir))
}

#[tauri::command]
pub async fn get_theme_css(app: AppHandle, id: String) -> Result<ThemeCss, String> {
    let dir = custom_themes_dir(&app)?;
    loader::get_theme_css(&id, &dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_theme_from_template(
    app: AppHandle,
    builtin_id: String,
) -> Result<String, String> {
    let dir = custom_themes_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    loader::create_from_template(&builtin_id, &dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_themes_folder(app: AppHandle) -> Result<(), String> {
    let dir = custom_themes_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}
