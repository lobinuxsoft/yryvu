// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands wrapping the repo clone path: `clone_repository`
//! drives the actual clone with a `Channel<CloneProgress>` for
//! streaming progress, while `clone_cancel` flips the per-session
//! flag so the running clone aborts on its next tick.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::ipc::Channel;

use crate::repo::clone::{
    clone_repository as clone_impl, registry, CloneOptions, CloneProgress, ProgressEmit,
};

#[tauri::command]
pub async fn clone_repository(
    session_id: String,
    url: String,
    dest_path: String,
    branch: Option<String>,
    depth: Option<u32>,
    recurse_submodules: bool,
    on_progress: Channel<CloneProgress>,
) -> Result<String, String> {
    let cancel = registry::register(session_id.clone());
    let emit: ProgressEmit = Arc::new(move |p| {
        let _ = on_progress.send(p);
    });
    let opts = CloneOptions {
        url,
        dest_path: PathBuf::from(dest_path),
        branch,
        depth,
        recurse_submodules,
    };
    let session_for_cleanup = session_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        clone_impl(opts, cancel, emit)
            .map(|p| p.display().to_string())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    registry::unregister(&session_for_cleanup);
    result
}

#[tauri::command]
pub fn clone_cancel(session_id: String) -> bool {
    registry::cancel(&session_id)
}
