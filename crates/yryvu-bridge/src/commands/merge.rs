// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{GitBackend, MergeResult, MergeStrategy};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn merge_branch(
    repo_path: String,
    source: String,
    strategy: MergeStrategy,
) -> Result<MergeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .merge_branch(&PathBuf::from(&repo_path), &source, strategy)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
