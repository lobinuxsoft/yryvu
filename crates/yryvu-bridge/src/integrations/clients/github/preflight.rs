// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub API preflight — validates the token and fetches the
//! authenticated user's profile via `GET /user`. Used both right
//! after a save (token entered manually or imported from `gh`) and
//! on app start to hydrate the connected state.
//!
//! Endpoint dispatch:
//! - GitHub.com → `https://api.github.com/user`
//! - GitHub Enterprise Server → `<hostname>/api/v3/user` (GHE
//!   convention, identical contract to .com).
//!
//! Required scopes for yryvu v1: `repo` (PR review surface) and
//! `read:org` (org-scoped PR access). The check happens after the
//! request — GitHub returns the granted scopes in the
//! `X-OAuth-Scopes` response header.

use serde::Deserialize;

use crate::backend::BackendError;

use super::super::types::UserInfo;
use super::{api_base, USER_AGENT};

const REQUIRED_SCOPES_V1: &[&str] = &["repo", "read:org"];

/// Honour the GitHub OAuth scope hierarchy: `admin:X` implies
/// `write:X` implies `read:X`. A token with `admin:org` satisfies a
/// `read:org` requirement even though the literal string isn't in
/// the granted list.
///
/// Non-prefixed scopes like `repo` and `gist` only satisfy themselves
/// (no implied `read:repo` etc — the GitHub docs treat `repo` as the
/// monolithic root). `repo` does NOT imply the more granular
/// `repo:status` / `public_repo` etc; we accept `repo` as the
/// canonical literal in our required set so the question doesn't
/// arise in practice.
fn scope_satisfies(granted: &[&str], required: &str) -> bool {
    if granted.contains(&required) {
        return true;
    }
    if let Some(target) = required.strip_prefix("read:") {
        let write_form = format!("write:{target}");
        let admin_form = format!("admin:{target}");
        if granted.iter().any(|g| *g == write_form || *g == admin_form) {
            return true;
        }
    }
    if let Some(target) = required.strip_prefix("write:") {
        let admin_form = format!("admin:{target}");
        if granted.iter().any(|g| *g == admin_form) {
            return true;
        }
    }
    false
}

/// Raw shape of GitHub's `GET /user` response — only the fields we
/// care about. `name` can be null for users who haven't set a
/// display name; we fall back to `login` in that case.
#[derive(Debug, Deserialize)]
struct GhUser {
    login: String,
    name: Option<String>,
    avatar_url: String,
}

/// Validate `token` against the GitHub API and return the
/// authenticated user's info. Maps HTTP status codes + headers to
/// typed [`BackendError`] variants so the UI can surface specific
/// CTAs (re-enter token / regenerate / wait for rate-limit reset /
/// retry network).
pub async fn preflight_github(
    token: &str,
    hostname: Option<&str>,
) -> Result<UserInfo, BackendError> {
    let base = api_base(hostname)?;
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;
    let resp = client
        .get(format!("{base}/user"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;

    let status = resp.status();
    let granted_scopes = resp
        .headers()
        .get("x-oauth-scopes")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(BackendError::InvalidToken);
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        // 403 + remaining=0 = rate-limited. Otherwise it's a permission
        // error which we treat as InvalidToken (token can't see the
        // resource).
        let remaining = resp
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        if remaining == Some(0) {
            let reset_at = resp
                .headers()
                .get("x-ratelimit-reset")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0);
            return Err(BackendError::RateLimited { reset_at });
        }
        return Err(BackendError::InvalidToken);
    }
    if !status.is_success() {
        return Err(BackendError::NetworkError {
            detail: format!("unexpected HTTP {status} from GitHub /user"),
        });
    }

    // Scope check: GitHub returns granted scopes as a comma-separated
    // list in `X-OAuth-Scopes`. Honour OAuth hierarchy when matching:
    // `admin:X` implies `write:X` implies `read:X`. So a token with
    // `admin:org` satisfies a `read:org` requirement even though the
    // literal string isn't in the granted list.
    let granted: Vec<&str> = granted_scopes
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    let missing: Vec<&&str> = REQUIRED_SCOPES_V1
        .iter()
        .filter(|req| !scope_satisfies(&granted, req))
        .collect();
    if !missing.is_empty() {
        return Err(BackendError::InsufficientScopes {
            granted: granted.join(", "),
            required: missing
                .iter()
                .map(|s| **s)
                .collect::<Vec<&str>>()
                .join(", "),
        });
    }

    let user: GhUser = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding /user response: {e}"),
    })?;
    Ok(UserInfo {
        display_name: user.name.unwrap_or_else(|| user.login.clone()),
        login: user.login,
        avatar_url: user.avatar_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_admin_implies_read() {
        let granted = vec!["admin:org", "repo"];
        assert!(scope_satisfies(&granted, "read:org"));
        assert!(scope_satisfies(&granted, "write:org"));
        assert!(scope_satisfies(&granted, "admin:org"));
    }

    #[test]
    fn scope_write_implies_read() {
        let granted = vec!["write:org"];
        assert!(scope_satisfies(&granted, "read:org"));
        assert!(scope_satisfies(&granted, "write:org"));
        assert!(!scope_satisfies(&granted, "admin:org"));
    }

    #[test]
    fn scope_literal_match() {
        let granted = vec!["repo", "gist"];
        assert!(scope_satisfies(&granted, "repo"));
        assert!(scope_satisfies(&granted, "gist"));
        assert!(!scope_satisfies(&granted, "user"));
    }

    #[test]
    fn scope_no_cross_target_match() {
        // admin:org should NOT satisfy read:user (different target).
        let granted = vec!["admin:org"];
        assert!(!scope_satisfies(&granted, "read:user"));
    }

    #[test]
    fn scope_real_world_gh_token() {
        // Reproduces the bug: `gh auth token` returns a token with
        // these scopes; the literal "read:org" isn't there but
        // "admin:org" is, so yryvu v1's required scopes should be
        // satisfied.
        let granted = vec![
            "admin:enterprise",
            "admin:gpg_key",
            "admin:org",
            "admin:org_hook",
            "admin:public_key",
            "admin:repo_hook",
            "admin:ssh_signing_key",
            "audit_log",
            "codespace",
            "copilot",
            "delete:packages",
            "delete_repo",
            "gist",
            "notifications",
            "project",
            "repo",
            "user",
            "workflow",
        ];
        for required in REQUIRED_SCOPES_V1 {
            assert!(
                scope_satisfies(&granted, required),
                "scope {required} should be satisfied"
            );
        }
    }
}
