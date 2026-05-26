// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{FileContent, FileContentSource};
use crate::repo::file_content::read_file_content as read_impl;

/// Read raw file content at a given source — backs the INLINE / CONTENT
/// diff view modes (issue #59). HUNK / SPLIT continue to use the
/// existing `diff_unstaged` / `diff_staged` / `commit_diff` endpoints.
#[tauri::command]
pub async fn read_file_content(
    repo_path: String,
    path: String,
    source: FileContentSource,
) -> Result<FileContent, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_impl(&PathBuf::from(&repo_path), &path, &source).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
