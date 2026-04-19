// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::GitBackend;
use crate::repo::GixBackend;

#[tauri::command]
pub async fn create_tag(
    repo_path: String,
    name: String,
    sha: String,
    message: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .create_tag(&PathBuf::from(&repo_path), &name, &sha, message.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
