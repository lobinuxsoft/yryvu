// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use crate::backend::{FileBytes, FileContentSource};
use crate::repo::file_bytes::read_file_bytes as read_impl;

/// Read raw blob bytes (base64 + MIME) at a given source — backs the
/// image diff viewer (issue #60). The UI builds a blob URL from the
/// base64 payload and revokes it on unmount.
#[tauri::command]
pub async fn read_file_bytes(
    repo_path: String,
    path: String,
    source: FileContentSource,
) -> Result<FileBytes, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_impl(&PathBuf::from(&repo_path), &path, &source).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
