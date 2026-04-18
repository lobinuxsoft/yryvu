// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use graph_core::{GraphRow, LaneAssigner};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::backend::{BranchInfo, GitBackend, MergeResult, MergeStrategy, RepoStateInfo};
use crate::repo::GixBackend;

#[derive(Debug, Clone, Serialize)]
pub struct GraphBatch {
    pub rows: Vec<GraphRow>,
    pub done: bool,
}

pub const GRAPH_BATCH_EVENT: &str = "graph:batch";

/// Streams the full HEAD history as batches over the `graph:batch` event.
#[tauri::command]
pub async fn stream_graph(
    app: AppHandle,
    repo_path: String,
    batch_size: Option<usize>,
) -> Result<(), String> {
    let batch_size = batch_size.unwrap_or(100).max(1);
    let path = PathBuf::from(&repo_path);

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let backend = GixBackend;
        let walk = backend.walk_commits(&path).map_err(|e| e.to_string())?;

        let mut assigner = LaneAssigner::new(32).map_err(|e| e.to_string())?;
        let mut buffer = Vec::with_capacity(batch_size);

        for maybe_commit in walk {
            let commit = maybe_commit.map_err(|e| e.to_string())?;
            buffer.push(assigner.assign(commit));
            if buffer.len() >= batch_size {
                flush(&app, &mut buffer, false).map_err(|e| e.to_string())?;
            }
        }
        flush(&app, &mut buffer, true).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(())
}

fn flush(app: &AppHandle, buffer: &mut Vec<GraphRow>, done: bool) -> tauri::Result<()> {
    let rows = std::mem::take(buffer);
    app.emit(GRAPH_BATCH_EVENT, GraphBatch { rows, done })
}

#[tauri::command]
pub async fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .list_branches(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_branch(
    repo_path: String,
    name: String,
    from: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .create_branch(&PathBuf::from(&repo_path), &name, from.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_local_branch(
    repo_path: String,
    name: String,
    force: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .delete_local_branch(&PathBuf::from(&repo_path), &name, force.unwrap_or(false))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rename_branch(
    repo_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .rename_branch(&PathBuf::from(&repo_path), &old_name, &new_name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn is_working_tree_dirty(repo_path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .is_working_tree_dirty(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn checkout_branch(repo_path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .checkout_branch(&PathBuf::from(&repo_path), &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stash_push(repo_path: String, message: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .stash_push(&PathBuf::from(&repo_path), message.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stash_pop(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .stash_pop(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

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

#[tauri::command]
pub async fn delete_remote_branch(
    repo_path: String,
    remote: String,
    name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .delete_remote_branch(&PathBuf::from(&repo_path), &remote, &name)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn abort_merge(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .abort_merge(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repo_state(repo_path: String) -> Result<RepoStateInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .repo_state(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
