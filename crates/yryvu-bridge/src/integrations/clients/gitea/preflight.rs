// SPDX-License-Identifier: AGPL-3.0-or-later

//! Gitea / Forgejo token validation + `UserInfo` fetch via
//! `GET /api/v1/user`.
//!
//! Gitea accepts both `Bearer <pat>` and the legacy `token <pat>`
//! header since v1.18; we standardise on Bearer to match the rest of
//! yryvu's per-provider clients. Scope adequacy checks at the first
//! repo query — preflight only verifies token identity.

use reqwest::Method;
use serde::Deserialize;

use crate::backend::BackendError;

use super::super::http::{self, GITEA_QUIRKS};
use super::super::types::UserInfo;
use super::api_base;

pub async fn preflight_gitea(
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
        "application/json",
    );
    let resp = http::execute(req, GITEA_QUIRKS).await?;
    let user: GiteaUser = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /user response", e))?;
    Ok(user.into())
}

#[derive(Debug, Deserialize)]
struct GiteaUser {
    login: String,
    full_name: Option<String>,
    avatar_url: Option<String>,
}

impl From<GiteaUser> for UserInfo {
    fn from(raw: GiteaUser) -> Self {
        Self {
            display_name: raw.full_name.unwrap_or_else(|| raw.login.clone()),
            login: raw.login,
            avatar_url: raw.avatar_url.unwrap_or_default(),
        }
    }
}
