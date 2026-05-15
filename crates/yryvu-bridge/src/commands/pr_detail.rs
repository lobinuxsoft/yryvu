// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for the PR detail panel (#91 GitHub, #93 GitLab):
//! full-PR fetch, commits / files / checks tabs, and the action-button
//! cluster (close / reopen / convert-draft / mark-ready / merge).
//!
//! Each command routes by `ProviderFamily`. Supported providers
//! return the cross-provider shape; the rest bubble a typed error
//! the frontend surfaces as a toast.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::integrations::{
    self, CheckRun, MergeMethod, MergeRequest, MrAction, PrAction, PrCommit, PrFile,
    PullRequestDetail,
};

use super::integration_routing::{is_self_hosted, ProviderFamily};

fn sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("integrations.json"))
}

async fn load_auth(
    app: &AppHandle,
    integration_type: String,
) -> Result<integrations::AuthData, String> {
    let path = sidecar_path(app)?;
    tauri::async_runtime::spawn_blocking({
        let integration_type = integration_type.clone();
        move || integrations::get_integration(&path as &Path, &integration_type)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("integration '{integration_type}' is not connected"))
}

fn pick_hostname(integration_type: &str, auth: &integrations::AuthData) -> Option<String> {
    is_self_hosted(integration_type)
        .then_some(auth.hostname.as_ref())
        .flatten()
        .cloned()
}

/// Verb the read-side panel emits. Same enum is used for both
/// providers; the per-family dispatch picks the concrete variant.
fn parse_action(action: &str) -> Result<(PrAction, MrAction), String> {
    match action {
        "close" => Ok((PrAction::Close, MrAction::Close)),
        "reopen" => Ok((PrAction::Reopen, MrAction::Reopen)),
        "convertToDraft" => Ok((PrAction::ConvertToDraft, MrAction::ConvertToDraft)),
        "markReadyForReview" => Ok((PrAction::MarkReadyForReview, MrAction::MarkReadyForReview)),
        other => Err(format!("unknown pr action: '{other}'")),
    }
}

fn unsupported_for_detail(integration_type: &str) -> String {
    format!(
        "PR detail view supports GitHub and GitLab in v1; '{integration_type}' lands in its own PR"
    )
}

#[tauri::command]
pub async fn integration_get_pr_detail(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    number: u64,
) -> Result<PullRequestDetail, String> {
    let auth = load_auth(&app, integration_type.clone()).await?;
    let hostname = pick_hostname(&integration_type, &auth);
    let host = hostname.as_deref();
    match ProviderFamily::from_integration_type(&integration_type) {
        ProviderFamily::Github => {
            integrations::get_github_pr_detail(&auth.token, host, &owner, &repo, number)
                .await
                .map_err(|e| e.to_string())
        }
        ProviderFamily::Gitlab => {
            integrations::get_gitlab_mr_detail(&auth.token, host, &owner, &repo, number)
                .await
                .map_err(|e| e.to_string())
        }
        _ => Err(unsupported_for_detail(&integration_type)),
    }
}

#[tauri::command]
pub async fn integration_list_pr_commits(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    number: u64,
) -> Result<Vec<PrCommit>, String> {
    let auth = load_auth(&app, integration_type.clone()).await?;
    let hostname = pick_hostname(&integration_type, &auth);
    let host = hostname.as_deref();
    match ProviderFamily::from_integration_type(&integration_type) {
        ProviderFamily::Github => {
            integrations::list_github_pr_commits(&auth.token, host, &owner, &repo, number)
                .await
                .map_err(|e| e.to_string())
        }
        ProviderFamily::Gitlab => {
            integrations::list_gitlab_mr_commits(&auth.token, host, &owner, &repo, number)
                .await
                .map_err(|e| e.to_string())
        }
        _ => Err(unsupported_for_detail(&integration_type)),
    }
}

#[tauri::command]
pub async fn integration_list_pr_files(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    number: u64,
) -> Result<Vec<PrFile>, String> {
    let auth = load_auth(&app, integration_type.clone()).await?;
    let hostname = pick_hostname(&integration_type, &auth);
    let host = hostname.as_deref();
    match ProviderFamily::from_integration_type(&integration_type) {
        ProviderFamily::Github => {
            integrations::list_github_pr_files(&auth.token, host, &owner, &repo, number)
                .await
                .map_err(|e| e.to_string())
        }
        ProviderFamily::Gitlab => {
            integrations::list_gitlab_mr_files(&auth.token, host, &owner, &repo, number)
                .await
                .map_err(|e| e.to_string())
        }
        _ => Err(unsupported_for_detail(&integration_type)),
    }
}

/// Checks tab. GitHub uses the head SHA (the frontend already has
/// it); GitLab uses the MR iid for pipelines listing. The frontend
/// passes the SHA as the last argument either way — for GitLab the
/// SHA is unused. The parameter name stays `head_sha` to keep the
/// IPC surface stable across providers.
#[tauri::command]
pub async fn integration_list_pr_checks(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    head_sha: String,
    number: Option<u64>,
) -> Result<Vec<CheckRun>, String> {
    let auth = load_auth(&app, integration_type.clone()).await?;
    let hostname = pick_hostname(&integration_type, &auth);
    let host = hostname.as_deref();
    match ProviderFamily::from_integration_type(&integration_type) {
        ProviderFamily::Github => {
            integrations::list_github_pr_checks(&auth.token, host, &owner, &repo, &head_sha)
                .await
                .map_err(|e| e.to_string())
        }
        ProviderFamily::Gitlab => {
            let iid = number.ok_or_else(|| {
                "GitLab checks require the MR iid; pass `number` from the panel".to_string()
            })?;
            integrations::list_gitlab_mr_pipelines(&auth.token, host, &owner, &repo, iid)
                .await
                .map_err(|e| e.to_string())
        }
        _ => Err(unsupported_for_detail(&integration_type)),
    }
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
    let (gh_action, gl_action) = parse_action(&action)?;
    let auth = load_auth(&app, integration_type.clone()).await?;
    let hostname = pick_hostname(&integration_type, &auth);
    let host = hostname.as_deref();
    match ProviderFamily::from_integration_type(&integration_type) {
        ProviderFamily::Github => {
            integrations::github_pr_action(&auth.token, host, &owner, &repo, number, gh_action)
                .await
                .map_err(|e| e.to_string())
        }
        ProviderFamily::Gitlab => {
            integrations::gitlab_mr_action(&auth.token, host, &owner, &repo, number, gl_action)
                .await
                .map_err(|e| e.to_string())
        }
        _ => Err(unsupported_for_detail(&integration_type)),
    }
}

/// Merge a PR via `PUT /pulls/{number}/merge`. `method` is one of
/// `merge | squash | rebase` (matches the frontend enum verbatim).
/// On success, optionally fires a `DELETE /git/refs/heads/{headRef}`
/// to drop the source branch — failures of that follow-up don't fail
/// the merge (the user's primary intent already succeeded).
///
/// Argument count is gated by the Tauri IPC surface (each param maps
/// to one camelCase key on the JS side); refactoring into a wrapper
/// struct would force the frontend to serialise an envelope, costing
/// more than it saves.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn integration_merge_pr(
    app: AppHandle,
    integration_type: String,
    owner: String,
    repo: String,
    number: u64,
    method: String,
    commit_title: Option<String>,
    commit_message: Option<String>,
    delete_source_branch: bool,
) -> Result<PullRequestDetail, String> {
    match ProviderFamily::from_integration_type(&integration_type) {
        ProviderFamily::Github => Ok(()),
        _ => Err(format!(
            "PR merge form is GitHub-only in v1; '{integration_type}' lands in #94"
        )),
    }?;
    let auth = load_auth(&app, integration_type.clone()).await?;
    let hostname = pick_hostname(&integration_type, &auth);
    let parsed_method = match method.as_str() {
        "merge" => MergeMethod::Merge,
        "squash" => MergeMethod::Squash,
        "rebase" => MergeMethod::Rebase,
        other => return Err(format!("unknown merge method: '{other}'")),
    };
    let request = MergeRequest {
        method: parsed_method,
        commit_title,
        commit_message,
    };
    let detail = integrations::github_merge_pr(
        &auth.token,
        hostname.as_deref(),
        &owner,
        &repo,
        number,
        request,
    )
    .await
    .map_err(|e| e.to_string())?;
    if delete_source_branch {
        if let Err(err) = integrations::github_delete_branch(
            &auth.token,
            hostname.as_deref(),
            &owner,
            &repo,
            &detail.head_ref,
        )
        .await
        {
            // Soft-fail: the merge already succeeded, so we surface
            // the branch-delete failure as a log without flipping
            // the command result.
            eprintln!("github delete branch failed (branch survives): {err}");
        }
    }
    Ok(detail)
}
