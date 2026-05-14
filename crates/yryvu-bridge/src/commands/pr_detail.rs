// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for the PR detail panel (#91): full-PR fetch,
//! commits / files / checks tabs, and the action-button cluster
//! (close / reopen / convert-draft / mark-ready).
//!
//! Currently GitHub-only at the dispatcher level; GitLab / Gitea
//! detail surfaces follow in their own per-provider PRs. Each
//! command routes by `integration_type` and returns
//! [`BackendError::NotImplemented`] for non-GitHub providers so the
//! frontend can degrade gracefully (show "Detail view is GitHub-only
//! in v1" instead of crashing).

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::integrations::{self, CheckRun, PrAction, PrCommit, PrFile, PullRequestDetail};

fn sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("integrations.json"))
}

async fn load_auth(
    app: &AppHandle,
    integration_type: String,
) -> Result<integrations::AuthData, String> {
    let path = sidecar_path(app)?;
    let auth = tauri::async_runtime::spawn_blocking({
        let integration_type = integration_type.clone();
        move || integrations::get_integration(&path as &Path, &integration_type)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("integration '{integration_type}' is not connected"))?;
    Ok(auth)
}

fn pick_hostname(integration_type: &str, auth: &integrations::AuthData) -> Option<String> {
    if integration_type == "githubEnterprise" {
        auth.hostname.clone()
    } else {
        None
    }
}

fn unsupported_provider(integration_type: &str) -> Result<(), String> {
    match integration_type {
        "github" | "githubEnterprise" => Ok(()),
        _ => Err(format!(
            "PR detail view is GitHub-only in v1; '{integration_type}' lands in its own PR"
        )),
    }
}

#[tauri::command]
pub async fn integration_get_pr_detail(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    number: u64,
) -> Result<PullRequestDetail, String> {
    unsupported_provider(&integration_type)?;
    let auth = load_auth(&app, integration_type.clone()).await?;
    let hostname = pick_hostname(&integration_type, &auth);
    integrations::get_github_pr_detail(&auth.token, hostname.as_deref(), &owner, &repo, number)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn integration_list_pr_commits(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    number: u64,
) -> Result<Vec<PrCommit>, String> {
    unsupported_provider(&integration_type)?;
    let auth = load_auth(&app, integration_type.clone()).await?;
    let hostname = pick_hostname(&integration_type, &auth);
    integrations::list_github_pr_commits(&auth.token, hostname.as_deref(), &owner, &repo, number)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn integration_list_pr_files(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    number: u64,
) -> Result<Vec<PrFile>, String> {
    unsupported_provider(&integration_type)?;
    let auth = load_auth(&app, integration_type.clone()).await?;
    let hostname = pick_hostname(&integration_type, &auth);
    integrations::list_github_pr_files(&auth.token, hostname.as_deref(), &owner, &repo, number)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn integration_list_pr_checks(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    head_sha: String,
) -> Result<Vec<CheckRun>, String> {
    unsupported_provider(&integration_type)?;
    let auth = load_auth(&app, integration_type.clone()).await?;
    let hostname = pick_hostname(&integration_type, &auth);
    integrations::list_github_pr_checks(&auth.token, hostname.as_deref(), &owner, &repo, &head_sha)
        .await
        .map_err(|e| e.to_string())
}

/// `action` is `close | reopen | convertToDraft | markReadyForReview`
/// (camelCase to match the frontend enum). Returns the post-mutation
/// PR detail so the panel can refresh in one round-trip.
#[tauri::command]
pub async fn integration_pr_action(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    number: u64,
    action: String,
) -> Result<PullRequestDetail, String> {
    unsupported_provider(&integration_type)?;
    let auth = load_auth(&app, integration_type.clone()).await?;
    let hostname = pick_hostname(&integration_type, &auth);
    let parsed = match action.as_str() {
        "close" => PrAction::Close,
        "reopen" => PrAction::Reopen,
        "convertToDraft" => PrAction::ConvertToDraft,
        "markReadyForReview" => PrAction::MarkReadyForReview,
        other => return Err(format!("unknown pr action: '{other}'")),
    };
    integrations::github_pr_action(
        &auth.token,
        hostname.as_deref(),
        &owner,
        &repo,
        number,
        parsed,
    )
    .await
    .map_err(|e| e.to_string())
}
