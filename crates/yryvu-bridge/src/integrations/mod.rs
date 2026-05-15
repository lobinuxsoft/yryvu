// SPDX-License-Identifier: AGPL-3.0-or-later

//! Integration credential persistence — the Rust-side store backing
//! the frontend's PAT entry / OAuth flows. Two layers:
//!
//! - [`keyring`] — secret tokens go to the OS keyring (libsecret /
//!   macOS Keychain / Windows Credential Vault).
//! - [`sidecar`] — non-secret metadata (hostnames for self-hosted
//!   variants + per-integration `configured` flag) goes to a JSON
//!   file in the app's local data dir, atomic-write + 0600.
//!
//! The combined API lives at the [`mod.rs`] level so call sites get a
//! single entry point per operation. Keyring failures map to typed
//! [`BackendError`] variants; the sidecar fails noisily on schema
//! mismatch but otherwise silently succeeds.

pub mod clients;
mod keyring;
pub mod oauth;
mod sidecar;
mod types;

pub use clients::{
    create_comment, create_gitea_issue, create_gitea_pr, create_github_issue, create_github_pr,
    create_gitlab_issue, create_gitlab_pr, create_issue, create_pr, enrich_github_prs,
    get_gitea_issue_detail, get_gitea_pr_detail, get_github_issue_detail, get_github_pr_detail,
    get_gitlab_issue_detail, get_gitlab_mr_detail, get_issue_detail, gitea_merge_pr,
    gitea_pr_action, github_delete_branch, github_merge_pr, github_pr_action, gitlab_merge_mr,
    gitlab_mr_action, gitlab_rebase_mr, list_collaborators, list_comments,
    list_gitea_collaborators, list_gitea_issues, list_gitea_labels, list_gitea_milestones,
    list_gitea_pr_checks, list_gitea_pr_commits, list_gitea_pr_files, list_gitea_prs,
    list_github_collaborators, list_github_issues, list_github_labels, list_github_milestones,
    list_github_pr_checks, list_github_pr_commits, list_github_pr_files, list_gitlab_collaborators,
    list_gitlab_issues, list_gitlab_labels, list_gitlab_milestones, list_gitlab_mr_commits,
    list_gitlab_mr_files, list_gitlab_mr_pipelines, list_gitlab_mrs, list_issues, list_labels,
    list_milestones, list_prs, preflight, search_gitea_prs, search_github_prs, search_gitlab_mrs,
    CheckRun, CiStatus, Comment, CommentTarget, CreateCommentInput, CreateIssueInput,
    CreatePrInput, Identifier, IssueDetail, IssueState, IssueSummary, Label, MergeMethod,
    MergeRequest, MrAction, PrAction, PrCommit, PrFile, ProjectMergeMethod, ProjectMergeSettings,
    ProjectSquashOption, PullRequestDetail, PullRequestState, PullRequestSummary, ReviewDecision,
    UserInfo,
};
pub use keyring::{get_token, remove_token, save_token};
pub use sidecar::{read as read_sidecar, write as write_sidecar, IntegrationsConfig};
pub use types::{AuthData, IntegrationEntry, SIDECAR_VERSION};

use std::path::Path;

use crate::backend::BackendError;

/// Store credentials for `integration_type`. Writes the secret token
/// to the keyring and the metadata (hostname + `configured: true`) to
/// the sidecar in one logical operation.
///
/// **Atomicity caveat**: the two writes aren't transactional. If the
/// keyring write succeeds and the sidecar write fails, a recovery
/// pass is needed (the keyring has a token but the sidecar says
/// "not configured"). For chajá's UX this is acceptable: the next
/// successful save overwrites consistently, and the orphan keyring
/// entry doesn't leak (it's just unused). Callers don't need to
/// worry about it.
pub fn save_integration(
    sidecar_path: &Path,
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
) -> Result<(), BackendError> {
    save_token(integration_type, token)?;
    let mut cfg = read_sidecar(sidecar_path)?;
    cfg.integrations.insert(
        integration_type.to_string(),
        IntegrationEntry {
            configured: true,
            hostname: hostname.map(String::from),
        },
    );
    write_sidecar(sidecar_path, &cfg)?;
    Ok(())
}

/// Fetch credentials for `integration_type`. Returns `Ok(None)` when
/// no token is stored (the sidecar's `configured` flag false OR the
/// keyring entry is missing — either way, treat as "not configured").
pub fn get_integration(
    sidecar_path: &Path,
    integration_type: &str,
) -> Result<Option<AuthData>, BackendError> {
    let cfg = read_sidecar(sidecar_path)?;
    let entry = match cfg.integrations.get(integration_type) {
        Some(e) if e.configured => e,
        _ => return Ok(None),
    };
    let token = match get_token(integration_type)? {
        Some(t) => t,
        None => return Ok(None),
    };
    Ok(Some(AuthData {
        token,
        hostname: entry.hostname.clone(),
    }))
}

/// Wipe credentials for `integration_type`. Removes the keyring entry
/// AND clears the sidecar's `configured` flag. The hostname (if any)
/// is preserved so a re-connect doesn't lose the user's URL config.
pub fn remove_integration(sidecar_path: &Path, integration_type: &str) -> Result<(), BackendError> {
    remove_token(integration_type)?;
    let mut cfg = read_sidecar(sidecar_path)?;
    if let Some(entry) = cfg.integrations.get_mut(integration_type) {
        entry.configured = false;
    }
    write_sidecar(sidecar_path, &cfg)?;
    Ok(())
}

/// Enumerate integration types with a `configured: true` entry in the
/// sidecar. Cheap (no keyring round-trip) — drives the UI's
/// "connected" indicator dot in the sub-tab sidebar.
pub fn list_configured(sidecar_path: &Path) -> Result<Vec<String>, BackendError> {
    let cfg = read_sidecar(sidecar_path)?;
    Ok(cfg
        .integrations
        .iter()
        .filter(|(_, e)| e.configured)
        .map(|(k, _)| k.clone())
        .collect())
}

/// Set just the hostname (no token write) — the user may configure
/// the URL for a self-hosted variant before pasting/importing the
/// token. Idempotent.
pub fn set_hostname(
    sidecar_path: &Path,
    integration_type: &str,
    hostname: &str,
) -> Result<(), BackendError> {
    let mut cfg = read_sidecar(sidecar_path)?;
    let entry = cfg
        .integrations
        .entry(integration_type.to_string())
        .or_default();
    entry.hostname = Some(hostname.to_string());
    write_sidecar(sidecar_path, &cfg)?;
    Ok(())
}

/// Read just the hostname for a self-hosted integration. Returns
/// `None` when no entry or no hostname is set.
pub fn get_hostname(
    sidecar_path: &Path,
    integration_type: &str,
) -> Result<Option<String>, BackendError> {
    let cfg = read_sidecar(sidecar_path)?;
    Ok(cfg
        .integrations
        .get(integration_type)
        .and_then(|e| e.hostname.clone()))
}
