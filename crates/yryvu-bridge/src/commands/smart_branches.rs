// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::GitBackend;
use crate::repo::GixBackend;

#[tauri::command]
pub async fn smart_visible_refs(
    repo_path: String,
    profile_default: Option<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .smart_visible_refs(&PathBuf::from(&repo_path), profile_default.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
