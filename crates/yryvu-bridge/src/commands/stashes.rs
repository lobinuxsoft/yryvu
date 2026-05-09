// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{GitBackend, StashInfo};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn list_stashes(repo_path: String) -> Result<Vec<StashInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .list_stashes(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
