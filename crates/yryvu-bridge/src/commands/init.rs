// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri command: initialize a new repository at the given path.

use std::path::Path;

use crate::repo::init::{init_repository as init_impl, InitOptions};

#[tauri::command]
pub async fn init_repository(
    path: String,
    branch_name: String,
    gitignore_template: Option<String>,
    license_template: Option<String>,
    initialize_first_commit: bool,
    bare: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let opts = InitOptions {
            branch_name,
            gitignore_template,
            license_template,
            initialize_first_commit,
            bare,
        };
        init_impl(Path::new(&path), opts)
            .map(|p| p.display().to_string())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
