// SPDX-License-Identifier: AGPL-3.0-or-later

use tauri::AppHandle;

use crate::integrations::{self, Identifier};

use super::{host_for, load_auth_and_host};

/// List repository labels. Populates the labels MultiSelect in the
/// Create Issue / Create PR forms; cross-provider [`Identifier`]
/// shape (GitHub `id == name`, GitLab/Gitea `id` is numeric string).
#[tauri::command]
pub async fn integration_list_labels(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    owner: String,
    repo: String,
) -> Result<Vec<Identifier>, String> {
    let auth = load_auth_and_host(&app, profile_id.as_deref(), &integration_type).await?;
    let hostname = host_for(&integration_type, &auth);
    integrations::list_labels(&integration_type, &auth.token, hostname, &owner, &repo)
        .await
        .map_err(|e| e.to_string())
}

/// List repository collaborators. Populates the assignees +
/// reviewers MultiSelect; cross-provider [`Identifier`] shape (GitHub
/// + Gitea `id == login/username`, GitLab `id` is numeric string).
#[tauri::command]
pub async fn integration_list_collaborators(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    owner: String,
    repo: String,
) -> Result<Vec<Identifier>, String> {
    let auth = load_auth_and_host(&app, profile_id.as_deref(), &integration_type).await?;
    let hostname = host_for(&integration_type, &auth);
    integrations::list_collaborators(&integration_type, &auth.token, hostname, &owner, &repo)
        .await
        .map_err(|e| e.to_string())
}

/// List active/open repository milestones. Populates the milestone
/// Select; cross-provider [`Identifier`] shape (numeric id string).
#[tauri::command]
pub async fn integration_list_milestones(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
    owner: String,
    repo: String,
) -> Result<Vec<Identifier>, String> {
    let auth = load_auth_and_host(&app, profile_id.as_deref(), &integration_type).await?;
    let hostname = host_for(&integration_type, &auth);
    integrations::list_milestones(&integration_type, &auth.token, hostname, &owner, &repo)
        .await
        .map_err(|e| e.to_string())
}
