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

#[cfg(test)]
mod scoping_tests;

pub use clients::{
    create_comment, create_gitea_issue, create_gitea_pr, create_github_issue, create_github_pr,
    create_gitlab_issue, create_gitlab_pr, create_issue, create_pr, enrich_github_prs,
    get_gitea_issue_detail, get_gitea_pr_detail, get_github_issue_detail, get_github_pr_detail,
    get_gitlab_issue_detail, get_gitlab_mr_detail, get_issue_detail, gitea_merge_pr,
    gitea_pr_action, github_delete_branch, github_merge_pr, github_pr_action, gitlab_merge_mr,
    gitlab_mr_action, gitlab_rebase_mr, list_clone_candidates, list_collaborators, list_comments,
    list_gitea_clone_candidates, list_gitea_collaborators, list_gitea_issues, list_gitea_labels,
    list_gitea_milestones, list_gitea_pr_checks, list_gitea_pr_commits, list_gitea_pr_files,
    list_gitea_prs, list_github_clone_candidates, list_github_collaborators, list_github_issues,
    list_github_labels, list_github_milestones, list_github_pr_checks, list_github_pr_commits,
    list_github_pr_files, list_gitlab_clone_candidates, list_gitlab_collaborators,
    list_gitlab_issues, list_gitlab_labels, list_gitlab_milestones, list_gitlab_mr_commits,
    list_gitlab_mr_files, list_gitlab_mr_pipelines, list_gitlab_mrs, list_issues, list_labels,
    list_milestones, list_prs, preflight, search_gitea_prs, search_github_prs, search_gitlab_mrs,
    CheckRun, CiStatus, CloneRepoCandidate, Comment, CommentTarget, CreateCommentInput,
    CreateIssueInput, CreatePrInput, Identifier, IssueDetail, IssueState, IssueSummary, Label,
    MergeMethod, MergeRequest, MrAction, OwnerKind, PrAction, PrCommit, PrFile, ProjectMergeMethod,
    ProjectMergeSettings, ProjectSquashOption, PullRequestDetail, PullRequestState,
    PullRequestSummary, ReviewDecision, UserInfo,
};
pub use keyring::{get_token, remove_token, save_token};
pub use sidecar::{read as read_sidecar, write as write_sidecar, IntegrationsConfig};
pub use types::{AuthData, IntegrationEntry, SIDECAR_VERSION};

use std::path::Path;

use crate::backend::BackendError;

/// Compose the keyring account for a token. Profile-scoped tokens use
/// `"{profile_id}:{type}"`; the global/legacy namespace is just `type`.
/// Profile IDs are UUIDs (no `:`), so the namespaces never collide.
fn account(profile_id: Option<&str>, integration_type: &str) -> String {
    match profile_id {
        Some(pid) => format!("{pid}:{integration_type}"),
        None => integration_type.to_string(),
    }
}

/// Read-only handle to the entry for `(profile_id, type)`. `None`
/// profile reads the legacy global map.
fn lookup_entry<'a>(
    cfg: &'a IntegrationsConfig,
    profile_id: Option<&str>,
    integration_type: &str,
) -> Option<&'a IntegrationEntry> {
    match profile_id {
        Some(pid) => cfg.profiles.get(pid).and_then(|m| m.get(integration_type)),
        None => cfg.integrations.get(integration_type),
    }
}

/// Resolve `(profile_id, type)` to its `AuthData` (sidecar entry + keyring
/// token), or `None` when not configured or the token is missing.
fn resolve_entry(
    cfg: &IntegrationsConfig,
    profile_id: Option<&str>,
    integration_type: &str,
) -> Result<Option<AuthData>, BackendError> {
    let entry = match lookup_entry(cfg, profile_id, integration_type) {
        Some(e) if e.configured => e,
        _ => return Ok(None),
    };
    let token = match get_token(&account(profile_id, integration_type))? {
        Some(t) => t,
        None => return Ok(None),
    };
    Ok(Some(AuthData {
        token,
        hostname: entry.hostname.clone(),
    }))
}

/// Store credentials under `profile_id` (or the legacy global namespace
/// when `None`). Writes the secret token to the keyring and the metadata
/// (hostname + `configured: true`) to the sidecar in one logical op.
///
/// **Atomicity caveat**: the two writes aren't transactional. If the
/// keyring write succeeds and the sidecar write fails, a recovery
/// pass is needed (the keyring has a token but the sidecar says
/// "not configured"). For yryvu's UX this is acceptable: the next
/// successful save overwrites consistently, and the orphan keyring
/// entry doesn't leak (it's just unused). Callers don't need to
/// worry about it.
pub fn save_integration(
    sidecar_path: &Path,
    profile_id: Option<&str>,
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
) -> Result<(), BackendError> {
    save_token(&account(profile_id, integration_type), token)?;
    let mut cfg = read_sidecar(sidecar_path)?;
    let map = match profile_id {
        Some(pid) => cfg.profiles.entry(pid.to_string()).or_default(),
        None => &mut cfg.integrations,
    };
    map.insert(
        integration_type.to_string(),
        IntegrationEntry {
            configured: true,
            hostname: hostname.map(String::from),
        },
    );
    write_sidecar(sidecar_path, &cfg)?;
    Ok(())
}

/// Fetch credentials for `integration_type`, honouring `profile_id`.
///
/// - **`Some(pid)`** (panel context — "show this profile's state"):
///   the profile-scoped entry, else the legacy global namespace as a
///   migration fallback. Does NOT peek at other profiles, so the
///   connected indicator reflects the selected profile honestly.
/// - **`None`** (consumption context — git ops / API calls that didn't
///   specify a profile): the legacy namespace first, then any profile
///   that has this integration configured. This lets push / clone / PR
///   listing "just work" with whatever token the user connected,
///   scoped or not. When several profiles share a provider the choice
///   is arbitrary; callers wanting a specific account pass `Some(pid)`.
pub fn get_integration(
    sidecar_path: &Path,
    profile_id: Option<&str>,
    integration_type: &str,
) -> Result<Option<AuthData>, BackendError> {
    let cfg = read_sidecar(sidecar_path)?;
    if profile_id.is_some() {
        if let Some(auth) = resolve_entry(&cfg, profile_id, integration_type)? {
            return Ok(Some(auth));
        }
        return resolve_entry(&cfg, None, integration_type);
    }
    if let Some(auth) = resolve_entry(&cfg, None, integration_type)? {
        return Ok(Some(auth));
    }
    for pid in cfg.profiles.keys() {
        if let Some(auth) = resolve_entry(&cfg, Some(pid.as_str()), integration_type)? {
            return Ok(Some(auth));
        }
    }
    Ok(None)
}

/// Wipe credentials for `(profile_id, type)`. Removes the keyring entry
/// AND clears the sidecar's `configured` flag (hostname preserved). Does
/// not touch the legacy namespace when a profile is given.
pub fn remove_integration(
    sidecar_path: &Path,
    profile_id: Option<&str>,
    integration_type: &str,
) -> Result<(), BackendError> {
    remove_token(&account(profile_id, integration_type))?;
    let mut cfg = read_sidecar(sidecar_path)?;
    let entry = match profile_id {
        Some(pid) => cfg
            .profiles
            .get_mut(pid)
            .and_then(|m| m.get_mut(integration_type)),
        None => cfg.integrations.get_mut(integration_type),
    };
    if let Some(entry) = entry {
        entry.configured = false;
    }
    write_sidecar(sidecar_path, &cfg)?;
    Ok(())
}

/// Enumerate integration types with a `configured: true` entry.
///
/// - **`Some(pid)`** (panel): exactly that profile's configured types —
///   drives the "connected" dot for the selected profile.
/// - **`None`** (consumption): the union of the legacy namespace and
///   every profile, so a consumer that didn't specify a profile knows a
///   token exists *somewhere* (paired with [`get_integration`]'s
///   any-profile resolution). Deduplicated + sorted.
pub fn list_configured(
    sidecar_path: &Path,
    profile_id: Option<&str>,
) -> Result<Vec<String>, BackendError> {
    let cfg = read_sidecar(sidecar_path)?;
    match profile_id {
        Some(pid) => Ok(cfg
            .profiles
            .get(pid)
            .into_iter()
            .flatten()
            .filter(|(_, e)| e.configured)
            .map(|(k, _)| k.clone())
            .collect()),
        None => {
            let mut set = std::collections::BTreeSet::new();
            let maps = std::iter::once(&cfg.integrations).chain(cfg.profiles.values());
            for (k, e) in maps.flatten() {
                if e.configured {
                    set.insert(k.clone());
                }
            }
            Ok(set.into_iter().collect())
        }
    }
}

/// Set just the hostname (no token write) — the user may configure
/// the URL for a self-hosted variant before pasting/importing the
/// token. Idempotent.
pub fn set_hostname(
    sidecar_path: &Path,
    profile_id: Option<&str>,
    integration_type: &str,
    hostname: &str,
) -> Result<(), BackendError> {
    let mut cfg = read_sidecar(sidecar_path)?;
    let map = match profile_id {
        Some(pid) => cfg.profiles.entry(pid.to_string()).or_default(),
        None => &mut cfg.integrations,
    };
    map.entry(integration_type.to_string())
        .or_default()
        .hostname = Some(hostname.to_string());
    write_sidecar(sidecar_path, &cfg)?;
    Ok(())
}

/// Read the hostname for a self-hosted integration. Falls back to the
/// legacy namespace when a profile-scoped hostname isn't set. Returns
/// `None` when no entry or no hostname exists.
pub fn get_hostname(
    sidecar_path: &Path,
    profile_id: Option<&str>,
    integration_type: &str,
) -> Result<Option<String>, BackendError> {
    let cfg = read_sidecar(sidecar_path)?;
    let scoped = lookup_entry(&cfg, profile_id, integration_type).and_then(|e| e.hostname.clone());
    if scoped.is_none() && profile_id.is_some() {
        return Ok(lookup_entry(&cfg, None, integration_type).and_then(|e| e.hostname.clone()));
    }
    Ok(scoped)
}
