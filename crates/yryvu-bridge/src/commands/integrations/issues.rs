// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use tauri::AppHandle;

use crate::integrations::{self, IssueDetail, IssueSummary};

use super::super::integration_routing::is_self_hosted;
use super::sidecar_path;

/// List issues for `owner/repo` on the named provider. Same auth +
/// hostname path as `integration_list_prs`; supported providers
/// route via [`integrations::list_issues`], others bubble up the
/// typed `NotImplemented` so the frontend can degrade gracefully.
#[tauri::command]
pub async fn integration_list_issues(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    owner: String,
    repo: String,
) -> Result<Vec<IssueSummary>, String> {
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
    integrations::list_issues(&integration_type, &auth.token, hostname, &owner, &repo)
        .await
        .map_err(|e| e.to_string())
}

/// Fetch one issue's full detail (body + metadata) for the in-app
/// detail panel. Same auth + hostname routing as
/// `integration_list_issues`; supported providers route via
/// [`integrations::get_issue_detail`].
#[tauri::command]
pub async fn integration_get_issue_detail(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    owner: String,
    repo: String,
    number: u64,
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
    integrations::get_issue_detail(
        &integration_type,
        &auth.token,
        hostname,
        &owner,
        &repo,
        number,
    )
    .await
    .map_err(|e| e.to_string())
}
