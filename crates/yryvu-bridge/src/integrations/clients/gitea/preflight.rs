// SPDX-License-Identifier: AGPL-3.0-or-later

//! Gitea / Forgejo token validation + `UserInfo` fetch via
//! `GET /api/v1/user`.
//!
//! Required token scopes for v1: `read:repository` + `read:user`.
//! Gitea returns granted scopes in the `X-Gitea-Token-Scopes` header
//! on token-authenticated calls; we surface scope mismatches at the
//! first PR query (403) since the preflight call itself succeeds with
//! a `read:user`-only token.

use serde::Deserialize;

use crate::backend::BackendError;

use super::super::types::UserInfo;
use super::{api_base, USER_AGENT};

/// Validate `token` against the Gitea API and return the
/// authenticated user's info. Gitea accepts both `token <pat>` and
/// `Bearer <pat>` auth headers since v1.18; we standardise on
/// `Bearer` to match the rest of yryvu's per-provider clients.
pub async fn preflight_gitea(
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
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(BackendError::InvalidToken);
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        return Err(BackendError::InvalidToken);
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        // Gitea uses the standard X-RateLimit-Reset header (seconds
        // since unix epoch). Fall back to 0 when missing.
        let reset_at = resp
            .headers()
            .get("x-ratelimit-reset")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        return Err(BackendError::RateLimited { reset_at });
    }
    if !status.is_success() {
        return Err(BackendError::NetworkError {
            detail: format!("unexpected HTTP {status} from Gitea /user"),
        });
    }

    let user: GiteaUser = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding /user response: {e}"),
    })?;
    Ok(UserInfo {
        display_name: user.full_name.unwrap_or_else(|| user.login.clone()),
        login: user.login,
        avatar_url: user.avatar_url.unwrap_or_default(),
    })
}

/// `GET /api/v1/user` response — only the fields we project.
/// `full_name` is the optional display name; `login` is the stable
/// handle.
#[derive(Debug, Deserialize)]
struct GiteaUser {
    login: String,
    full_name: Option<String>,
    avatar_url: Option<String>,
}
