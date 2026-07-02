// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands to start/stop the active-repository file watcher. The
//! frontend calls [`watch_repo`] whenever the active repo changes (see
//! `state/repo.ts`) and [`unwatch_repo`] when the last repo closes. The
//! watcher emits `repo-refs-changed` / `repo-index-changed` /
//! `repo-worktree-changed` events the frontend listens on to refetch the
//! affected slice — see [`crate::repo::watcher`].

use std::path::Path;

use tauri::AppHandle;

use crate::repo::watcher;

#[tauri::command]
pub async fn watch_repo(app: AppHandle, repo_path: String) -> Result<(), String> {
    watcher::watch(app, Path::new(&repo_path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unwatch_repo() -> Result<(), String> {
    watcher::unwatch();
    Ok(())
}
