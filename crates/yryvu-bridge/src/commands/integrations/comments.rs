// SPDX-License-Identifier: AGPL-3.0-or-later

use tauri::AppHandle;

use crate::integrations::{self, Comment, CommentTarget, CreateCommentInput};

use super::{host_for, load_auth_and_host};

fn target_from_str(target: &str) -> Result<CommentTarget, String> {
    match target {
        "issue" => Ok(CommentTarget::Issue),
        "pullRequest" => Ok(CommentTarget::PullRequest),
        other => Err(format!("unknown comment target '{other}'")),
    }
}

/// List comments for an issue or pull/merge request. `target` is
/// either `"issue"` or `"pullRequest"`. The number is the per-repo
/// item identifier (issue.number / PR.number / MR.iid).
#[tauri::command]
pub async fn integration_list_comments(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    owner: String,
    repo: String,
    target: String,
    number: u64,
) -> Result<Vec<Comment>, String> {
    let target = target_from_str(&target)?;
    let auth = load_auth_and_host(&app, profile_id.as_deref(), &integration_type).await?;
    let hostname = host_for(&integration_type, &auth);
    integrations::list_comments(
        &integration_type,
        &auth.token,
        hostname,
        &owner,
        &repo,
        target,
        number,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Post a new comment to an issue or pull/merge request. Returns the
/// freshly created `Comment` so the UI can append it without a
/// follow-up fetch.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn integration_create_comment(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    owner: String,
    repo: String,
    target: String,
    number: u64,
    input: CreateCommentInput,
) -> Result<Comment, String> {
    let target = target_from_str(&target)?;
    let auth = load_auth_and_host(&app, profile_id.as_deref(), &integration_type).await?;
    let hostname = host_for(&integration_type, &auth);
    integrations::create_comment(
        &integration_type,
        &auth.token,
        hostname,
        &owner,
        &repo,
        target,
        number,
        &input,
    )
    .await
    .map_err(|e| e.to_string())
}
