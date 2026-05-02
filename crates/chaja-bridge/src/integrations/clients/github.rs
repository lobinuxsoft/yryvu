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
//! Required scopes for chajá v1: `repo` (PR review surface) and
//! `read:org` (org-scoped PR access). The check happens after the
//! request — GitHub returns the granted scopes in the
//! `X-OAuth-Scopes` response header.

use serde::Deserialize;

use crate::backend::BackendError;

use super::types::UserInfo;

const REQUIRED_SCOPES_V1: &[&str] = &["repo", "read:org"];

/// Raw shape of GitHub's `GET /user` response — only the fields we
/// care about. `name` can be null for users who haven't set a
/// display name; we fall back to `login` in that case.
#[derive(Debug, Deserialize)]
struct GhUser {
    login: String,
    name: Option<String>,
    avatar_url: String,
}

/// Resolve the API base URL for a `.com` or self-hosted endpoint.
/// chajá strips trailing slashes from user-supplied hostnames before
/// concatenating to avoid `//api/v3/user`.
fn api_base(hostname: Option<&str>) -> Result<String, BackendError> {
    match hostname {
        None => Ok("https://api.github.com".to_string()),
        Some(h) => {
            let trimmed = h.trim_end_matches('/');
            if trimmed.is_empty() {
                return Err(BackendError::NetworkError {
                    detail: "empty hostname for GH Enterprise".to_string(),
                });
            }
            Ok(format!("{trimmed}/api/v3"))
        }
    }
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
        .user_agent("chaja")
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
    // list in `X-OAuth-Scopes`. Compare against our v1 minimum set.
    let granted: Vec<&str> = granted_scopes
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    let missing: Vec<&&str> = REQUIRED_SCOPES_V1
        .iter()
        .filter(|req| !granted.iter().any(|g| g == *req))
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
    fn api_base_dot_com() {
        assert_eq!(api_base(None).unwrap(), "https://api.github.com");
    }

    #[test]
    fn api_base_ghe_appends_v3() {
        assert_eq!(
            api_base(Some("https://ghe.example.com")).unwrap(),
            "https://ghe.example.com/api/v3"
        );
    }

    #[test]
    fn api_base_strips_trailing_slash() {
        assert_eq!(
            api_base(Some("https://ghe.example.com/")).unwrap(),
            "https://ghe.example.com/api/v3"
        );
    }

    #[test]
    fn api_base_rejects_empty_hostname() {
        assert!(matches!(
            api_base(Some("/")),
            Err(BackendError::NetworkError { .. })
        ));
    }
}
