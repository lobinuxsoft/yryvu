// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;

use graph_core::{build_pinned_set, layout_commits, Commit, GraphRow};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::backend::{CombinedDiff, CommitDetail, CommitDiff, GitBackend, ResetMode};
use crate::repo::commits::{commit_details as commit_details_impl, pick_pinned_head_for_path};
use crate::repo::hosting::{detect_hosting_service, parse_repo_identifiers};
use crate::repo::GixBackend;

/// Streamed batch payload for `graph:batch` events.
///
/// `pinned_sha` carries the trunk pin selected by `pick_pinned_head_for_path`
/// so the frontend can mark the pinned ref group with a pin annotation
/// (issue #145, doc 06 stage-2 ordering). Same value across every batch in
/// a single stream — frontend reads it from the first batch and ignores
/// repeats. `None` only when the repo has no resolvable trunk (detached HEAD
/// + no `origin/HEAD` + no canonical-name local branch).
#[derive(Debug, Clone, Serialize)]
pub struct GraphBatch {
    pub rows: Vec<GraphRow>,
    pub done: bool,
    #[serde(rename = "pinnedSha")]
    pub pinned_sha: Option<String>,
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

        let rows = layout_commits(commits, 32, pinned_shas).map_err(|e| e.to_string())?;

        let mut buffer: Vec<GraphRow> = Vec::with_capacity(batch_size);
        for row in rows {
            buffer.push(row);
            if buffer.len() >= batch_size {
                flush(&app, &mut buffer, false, pinned_tip.as_deref())
                    .map_err(|e| e.to_string())?;
            }
        }
        flush(&app, &mut buffer, true, pinned_tip.as_deref()).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(())
}

fn flush(
    app: &AppHandle,
    buffer: &mut Vec<GraphRow>,
    done: bool,
    pinned_sha: Option<&str>,
) -> tauri::Result<()> {
    let rows = std::mem::take(buffer);
    app.emit(
        GRAPH_BATCH_EVENT,
        GraphBatch {
            rows,
            done,
            pinned_sha: pinned_sha.map(|s| s.to_string()),
        },
    )
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

/// Multi-revision / WIP-aware diff for the right-panel inspector. Drives the
/// chip stats, file list, and header copy in one round-trip — see
/// [`crate::backend::CombinedDiff`] for the shape.
#[tauri::command]
pub async fn combined_commit_diff(
    repo_path: String,
    shas: Vec<String>,
    include_workdir: bool,
) -> Result<CombinedDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        GixBackend
            .combined_commit_diff(&PathBuf::from(&repo_path), &shas, include_workdir)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Resolve full commit metadata for the right-panel inspector (message, body,
/// author, committer, timestamps, initials, gravatar hashes). Uses the gix
/// backend directly — no trait indirection since git2 fallback is not needed
/// for read-only metadata lookup.
#[tauri::command]
pub async fn commit_details(repo_path: String, sha: String) -> Result<CommitDetail, String> {
    tauri::async_runtime::spawn_blocking(move || {
        commit_details_impl(&PathBuf::from(&repo_path), &sha).map_err(|e| e.to_string())
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

/// Classify the repo's primary remote into a hosting-service tag used by
/// the frontend to pick a provider-native avatar source (GitHub's CDN
/// email→avatar endpoint, GitLab's user API, Gravatar fallback, …).
///
/// Returns one of `"github" | "gitlab" | "bitbucket" | "gitea" | "unknown"`.
/// Never fails — bare repos / zero-remote repos / opaque self-hosted URLs
/// all collapse to `"unknown"` and the frontend falls back to Gravatar.
#[tauri::command]
pub async fn get_hosting_service(repo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        Ok::<_, String>(detect_hosting_service(&path).as_str().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Provider classification + `(owner, repo)` for the active repo's
/// `origin` remote. Lets the frontend decide whether the PR /
/// Issues panels can fetch live data and on which provider.
///
/// `service` is always one of `"github" | "gitlab" | "bitbucket" |
/// "gitea" | "unknown"`. `owner` / `repo` are `None` for bare repos,
/// zero-remote repos, or URLs that don't split cleanly into two path
/// segments.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoProviderInfo {
    pub service: String,
    pub owner: Option<String>,
    pub repo: Option<String>,
}

#[tauri::command]
pub async fn get_repo_provider_info(repo_path: String) -> Result<RepoProviderInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let service = detect_hosting_service(&path).as_str().to_string();
        let (owner, repo) = gix::open(&path)
            .ok()
            .and_then(|r| crate::repo::hosting::remote_url(&r, "origin"))
            .and_then(|url| parse_repo_identifiers(&url))
            .map(|(o, r)| (Some(o), Some(r)))
            .unwrap_or((None, None));
        Ok::<_, String>(RepoProviderInfo {
            service,
            owner,
            repo,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
