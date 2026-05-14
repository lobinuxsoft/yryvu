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

use reqwest::Method;
use serde::Deserialize;

use crate::backend::BackendError;

use super::super::http::{self, GITHUB_QUIRKS};
use super::super::types::UserInfo;
use super::api_base;

const REQUIRED_SCOPES_V1: &[&str] = &["repo", "read:org"];

/// Honour the GitHub OAuth scope hierarchy: `admin:X` implies
/// `write:X` implies `read:X`. A token with `admin:org` satisfies a
/// `read:org` requirement even though the literal string isn't in
/// the granted list.
///
/// Non-prefixed scopes like `repo` and `gist` only satisfy themselves
/// — `repo` is the monolithic root scope; the granular variants like
/// `repo:status` / `public_repo` don't fan out from it.
fn scope_satisfies(granted: &[&str], required: &str) -> bool {
    if granted.contains(&required) {
        return true;
    }
    if let Some(target) = required.strip_prefix("read:") {
        return granted
            .iter()
            .any(|g| *g == format!("write:{target}") || *g == format!("admin:{target}"));
    }
    if let Some(target) = required.strip_prefix("write:") {
        return granted.iter().any(|g| *g == format!("admin:{target}"));
    }
    false
}

#[derive(Debug, Deserialize)]
struct GhUser {
    login: String,
    name: Option<String>,
    avatar_url: String,
}

impl From<GhUser> for UserInfo {
    fn from(raw: GhUser) -> Self {
        Self {
            display_name: raw.name.unwrap_or_else(|| raw.login.clone()),
            login: raw.login,
            avatar_url: raw.avatar_url,
        }
    }
}

/// Validate `token` against the GitHub API and return the
/// authenticated user's info. Maps HTTP status codes + headers to
/// typed [`BackendError`] variants via the shared
/// [`super::super::http`] helpers.
pub async fn preflight_github(
    token: &str,
    hostname: Option<&str>,
) -> Result<UserInfo, BackendError> {
    let base = api_base(hostname)?;
    let client = http::client()?;
    let req = http::authed(
        &client,
        Method::GET,
        &format!("{base}/user"),
        token,
        "application/vnd.github.v3+json",
    );
    let resp = http::execute(req, GITHUB_QUIRKS).await?;

    let granted_scopes = resp
        .headers()
        .get("x-oauth-scopes")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let granted: Vec<&str> = granted_scopes
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    let missing: Vec<&str> = REQUIRED_SCOPES_V1
        .iter()
        .copied()
        .filter(|req| !scope_satisfies(&granted, req))
        .collect();
    if !missing.is_empty() {
        return Err(BackendError::InsufficientScopes {
            granted: granted.join(", "),
            required: missing.join(", "),
        });
    }

    let user: GhUser = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /user response", e))?;
    Ok(user.into())
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
        let granted = vec!["admin:org"];
        assert!(!scope_satisfies(&granted, "read:user"));
    }

    #[test]
    fn scope_real_world_gh_token() {
        // Reproduces a real `gh auth token` output: the literal
        // "read:org" isn't granted but "admin:org" is.
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
