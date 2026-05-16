// SPDX-License-Identifier: AGPL-3.0-or-later

//! Gitea / Forgejo issue + PR comments via REST v1. Same endpoint
//! shape as GitHub — both issues and pulls share the issue-comments
//! surface server-side.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::super::http::{self, GITEA_QUIRKS};
use super::super::types::{Comment, CommentTarget, CreateCommentInput, UserInfo};
use super::api_base;

pub async fn list_comments(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    _target: CommentTarget,
    index: u64,
) -> Result<Vec<Comment>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/issues/{index}/comments?limit=50");
    let raw: Vec<GiteaComment> = get_json(token, &url).await?;
    Ok(raw.into_iter().map(Comment::from).collect())
}

pub async fn create_comment(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    _target: CommentTarget,
    index: u64,
    input: &CreateCommentInput,
) -> Result<Comment, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/issues/{index}/comments");
    let body = GiteaCommentBody { body: &input.body };
    let client = http::client()?;
    let req = http::authed(&client, Method::POST, &url, token, "application/json").json(&body);
    let resp = http::execute(req, GITEA_QUIRKS).await?;
    let raw: GiteaComment = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding POST /comments response", e))?;
    Ok(Comment::from(raw))
}

async fn get_json<T: serde::de::DeserializeOwned>(
    token: &str,
    url: &str,
) -> Result<T, BackendError> {
    let client = http::client()?;
    let req = http::authed(&client, Method::GET, url, token, "application/json");
    let resp = http::execute(req, GITEA_QUIRKS).await?;
    resp.json()
        .await
        .map_err(|e| http::decode_error("decoding /comments response", e))
}

#[derive(Debug, Serialize)]
struct GiteaCommentBody<'a> {
    body: &'a str,
}

#[derive(Debug, Deserialize)]
struct GiteaComment {
    id: u64,
    user: GiteaCommentUser,
    created_at: String,
    updated_at: String,
    body: Option<String>,
    html_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GiteaCommentUser {
    login: String,
    full_name: Option<String>,
    avatar_url: Option<String>,
}

impl From<GiteaComment> for Comment {
    fn from(raw: GiteaComment) -> Self {
        Self {
            id: raw.id.to_string(),
            author: UserInfo {
                display_name: raw.user.full_name.unwrap_or_else(|| raw.user.login.clone()),
                login: raw.user.login,
                avatar_url: raw.user.avatar_url.unwrap_or_default(),
            },
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            body: raw.body.unwrap_or_default(),
            html_url: raw.html_url.unwrap_or_default(),
        }
    }
}
