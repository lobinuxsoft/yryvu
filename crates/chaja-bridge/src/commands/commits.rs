// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use graph_core::{build_pinned_set, layout_commits, Commit, GraphRow};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::backend::{CommitDiff, GitBackend, ResetMode};
use crate::repo::commits::pick_pinned_head_for_path;
use crate::repo::GixBackend;

#[derive(Debug, Clone, Serialize)]
pub struct GraphBatch {
    pub rows: Vec<GraphRow>,
    pub done: bool,
}

pub const GRAPH_BATCH_EVENT: &str = "graph:batch";

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
        let commits: Vec<Commit> = walk
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let pinned_tip = pick_pinned_head_for_path(&path);
        let pinned_shas = build_pinned_set(&commits, pinned_tip.as_deref());

        let rows = layout_commits(commits, 32, pinned_shas)
            .map_err(|e| e.to_string())?;

        let mut buffer: Vec<GraphRow> = Vec::with_capacity(batch_size);
        for row in rows {
            buffer.push(row);
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
pub async fn commit_diff(repo_path: String, sha: String) -> Result<CommitDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .commit_diff(&PathBuf::from(&repo_path), &sha)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn checkout_commit(repo_path: String, sha: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .checkout_commit(&PathBuf::from(&repo_path), &sha)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn reset_to_commit(
    repo_path: String,
    sha: String,
    mode: ResetMode,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .reset_to_commit(&PathBuf::from(&repo_path), &sha, mode)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cherry_pick_commit(repo_path: String, sha: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .cherry_pick_commit(&PathBuf::from(&repo_path), &sha)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn revert_commit(repo_path: String, sha: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .revert_commit(&PathBuf::from(&repo_path), &sha)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn format_patch(
    repo_path: String,
    sha: String,
    out_dir: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .format_patch(&PathBuf::from(&repo_path), &sha, &PathBuf::from(&out_dir))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
