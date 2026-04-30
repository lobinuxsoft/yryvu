// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{GitBackend, SubmoduleInfo};
use crate::repo::GixBackend;

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
