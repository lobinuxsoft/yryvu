// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitLab token validation + `UserInfo` fetch via GraphQL `currentUser`.
//!
//! GitLab personal-access tokens carry one of three relevant scopes
//! for yryvu:
//!
//! - `read_api` — sufficient for the MR list panel (read MRs,
//!   projects, users).
//! - `api` — superset of `read_api`; needed by future detail / merge
//!   actions but no harm for v1.
//! - `read_user` — too narrow (covers `currentUser` only); MR queries
//!   will 403. We surface that as `InsufficientScopes` when the MR
//!   query later fails — the preflight itself only verifies that the
//!   token can name its bearer.
//!
//! Unlike GitHub, GitLab doesn't return granted scopes in a response
//! header — `currentUser` succeeds for any token that authenticates.
//! Scope adequacy gets checked at the first MR fetch instead.

use serde::Deserialize;
use serde_json::json;

use crate::backend::BackendError;

use super::super::types::UserInfo;
use super::{graphql_endpoint, USER_AGENT};

const PREFLIGHT_QUERY: &str = "query { currentUser { username name avatarUrl } }";

/// Validate `token` against the GitLab API and return the
/// authenticated user's info. Maps HTTP status codes to typed
/// [`BackendError`] variants so the UI can surface the right toast.
pub async fn preflight_gitlab(
    token: &str,
    hostname: Option<&str>,
) -> Result<UserInfo, BackendError> {
    let endpoint = graphql_endpoint(hostname)?;
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;
    let resp = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .json(&json!({ "query": PREFLIGHT_QUERY }))
        .send()
        .await
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(BackendError::InvalidToken);
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        // GitLab uses `RateLimit-Reset` (RFC 9239) rather than
        // X-RateLimit-Reset. Fall back to 0 when missing.
        let reset_at = resp
            .headers()
            .get("ratelimit-reset")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        return Err(BackendError::RateLimited { reset_at });
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        return Err(BackendError::InvalidToken);
    }
    if !status.is_success() {
        return Err(BackendError::NetworkError {
            detail: format!("unexpected HTTP {status} from GitLab GraphQL"),
        });
    }

    let body: GlGraphqlResp = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding /graphql response: {e}"),
    })?;
    if let Some(errors) = body.errors {
        if !errors.is_empty() {
            return Err(BackendError::NetworkError {
                detail: format!(
                    "GraphQL errors: {}",
                    errors
                        .iter()
                        .map(|e| e.message.as_str())
                        .collect::<Vec<_>>()
                        .join("; ")
                ),
            });
        }
    }
    let user = body
        .data
        .and_then(|d| d.current_user)
        .ok_or_else(|| BackendError::InvalidToken)?;
    Ok(UserInfo {
        display_name: user.name.unwrap_or_else(|| user.username.clone()),
        login: user.username,
        avatar_url: user.avatar_url.unwrap_or_default(),
    })
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GlGraphqlResp {
    #[serde(default)]
    data: Option<GlGraphqlData>,
    #[serde(default)]
    errors: Option<Vec<GlGraphqlError>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlGraphqlData {
    #[serde(default)]
    current_user: Option<GlCurrentUser>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlCurrentUser {
    username: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GlGraphqlError {
    message: String,
}
