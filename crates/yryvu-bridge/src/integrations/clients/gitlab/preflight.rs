// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitLab token validation + `UserInfo` fetch via GraphQL `currentUser`.
//!
//! Required scope for v1: `read_user` (verifies token identity).
//! `read_api` is the higher bar required to list MRs; checked at the
//! first MR query via [`super::super::http::GITLAB_QUIRKS`] which
//! maps 403 → `InsufficientScopes { required: "read_api" }`.

use reqwest::Method;
use serde::Deserialize;
use serde_json::json;

use crate::backend::BackendError;

use super::super::http::{self, GITLAB_PREFLIGHT_QUIRKS};
use super::super::types::UserInfo;
use super::graphql_endpoint;

const PREFLIGHT_QUERY: &str = "query { currentUser { username name avatarUrl } }";

pub async fn preflight_gitlab(
    token: &str,
    hostname: Option<&str>,
) -> Result<UserInfo, BackendError> {
    let endpoint = graphql_endpoint(hostname)?;
    let client = http::client()?;
    let req = http::authed(&client, Method::POST, &endpoint, token, "application/json")
        .json(&json!({ "query": PREFLIGHT_QUERY }));
    let resp = http::execute(req, GITLAB_PREFLIGHT_QUIRKS).await?;
    let body: GlGraphqlResp = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /graphql response", e))?;
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
        .ok_or(BackendError::InvalidToken)?;
    Ok(user.into())
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

impl From<GlCurrentUser> for UserInfo {
    fn from(raw: GlCurrentUser) -> Self {
        Self {
            display_name: raw.name.unwrap_or_else(|| raw.username.clone()),
            login: raw.username,
            avatar_url: raw.avatar_url.unwrap_or_default(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GlGraphqlError {
    message: String,
}
