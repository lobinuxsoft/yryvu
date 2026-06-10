// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use tauri::AppHandle;

use crate::integrations::{self, CreateIssueInput, CreatePrInput, IssueDetail, PullRequestDetail};

use super::super::integration_routing::is_self_hosted;
use super::sidecar_path;

/// Create a new pull / merge request on `owner/repo` via the named
/// provider. Same auth + hostname routing as the other PR commands;
/// returns the freshly created [`PullRequestDetail`] so the frontend
/// can route into the detail panel without a follow-up GET.
#[tauri::command]
pub async fn integration_create_pr(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    owner: String,
    repo: String,
    input: CreatePrInput,
) -> Result<PullRequestDetail, String> {
    let path = sidecar_path(&app)?;
    let auth = tauri::async_runtime::spawn_blocking({
        let integration_type = integration_type.clone();
        let profile_id = profile_id.clone();
        move || {
            integrations::get_integration(&path as &Path, profile_id.as_deref(), &integration_type)
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("integration '{integration_type}' is not connected"))?;
    let hostname = is_self_hosted(&integration_type)
        .then_some(auth.hostname.as_deref())
        .flatten();
    integrations::create_pr(
        &integration_type,
        &auth.token,
        hostname,
        &owner,
        &repo,
        &input,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Create a new issue on `owner/repo` via the named provider. Same
/// auth + hostname routing as the other issue commands; returns the
/// freshly created [`IssueDetail`] so the frontend can route to the
/// detail panel without a follow-up GET.
#[tauri::command]
pub async fn integration_create_issue(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    owner: String,
    repo: String,
    input: CreateIssueInput,
) -> Result<IssueDetail, String> {
    let path = sidecar_path(&app)?;
    let auth = tauri::async_runtime::spawn_blocking({
        let integration_type = integration_type.clone();
        let profile_id = profile_id.clone();
        move || {
            integrations::get_integration(&path as &Path, profile_id.as_deref(), &integration_type)
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("integration '{integration_type}' is not connected"))?;
    let hostname = is_self_hosted(&integration_type)
        .then_some(auth.hostname.as_deref())
        .flatten();
    integrations::create_issue(
        &integration_type,
        &auth.token,
        hostname,
        &owner,
        &repo,
        &input,
    )
    .await
    .map_err(|e| e.to_string())
}
