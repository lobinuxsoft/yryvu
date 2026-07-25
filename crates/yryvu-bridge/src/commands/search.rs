// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::GitBackend;
use crate::repo::search::{IndexCounts, SearchHit, SearchMode};
use crate::repo::GixBackend;

#[tauri::command]
pub async fn build_search_index(repo_path: String) -> Result<IndexCounts, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .build_search_index(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn search_repo(
    repo_path: String,
    mode: SearchMode,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .search_repo(&PathBuf::from(&repo_path), mode, &query, limit)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
