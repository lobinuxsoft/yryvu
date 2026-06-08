// SPDX-License-Identifier: AGPL-3.0-or-later

use tauri::AppHandle;

use crate::integrations::{self, CloneRepoCandidate};

use super::{host_for, load_auth_and_host};

/// List every repo the authenticated user can clone via
/// `integration_type`. Powers the Clone dialog's per-provider sub-tab
/// (#374). Returns a flat list — frontend groups by `owner` for the
/// GK-style org-headered dropdown.
#[tauri::command]
pub async fn integration_list_clone_candidates(
    app: AppHandle,
    profile_id: Option<String>,
    integration_type: String,
) -> Result<Vec<CloneRepoCandidate>, String> {
    let auth = load_auth_and_host(&app, profile_id.as_deref(), &integration_type).await?;
    let hostname = host_for(&integration_type, &auth);
    integrations::list_clone_candidates(&integration_type, &auth.token, hostname)
        .await
        .map_err(|e| e.to_string())
}
