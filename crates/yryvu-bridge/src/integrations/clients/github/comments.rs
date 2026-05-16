// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub issue + PR comments. GitHub treats PRs as issues for the
//! discussion thread, so both surfaces share the
//! `/repos/{o}/{r}/issues/{n}/comments` endpoint.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::super::http::{self, GITHUB_QUIRKS};
use super::super::types::{Comment, CommentTarget, CreateCommentInput, UserInfo};
use super::api_base;

pub async fn list_comments(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    _target: CommentTarget,
    number: u64,
) -> Result<Vec<Comment>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/issues/{number}/comments?per_page=100");
    let raw: Vec<GhComment> = get_json(token, &url).await?;
    Ok(raw.into_iter().map(Comment::from).collect())
}

pub async fn create_comment(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    _target: CommentTarget,
    number: u64,
    input: &CreateCommentInput,
) -> Result<Comment, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/issues/{number}/comments");
    let body = GhCommentBody { body: &input.body };
    let client = http::client()?;
    let req = http::authed(
        &client,
        Method::POST,
        &url,
        token,
        "application/vnd.github.v3+json",
    )
    .json(&body);
    let resp = http::execute(req, GITHUB_QUIRKS).await?;
    let raw: GhComment = resp
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
    let req = http::authed(
        &client,
        Method::GET,
        url,
        token,
        "application/vnd.github.v3+json",
    );
    let resp = http::execute(req, GITHUB_QUIRKS).await?;
    resp.json()
        .await
        .map_err(|e| http::decode_error("decoding /comments response", e))
}

#[derive(Debug, Serialize)]
struct GhCommentBody<'a> {
    body: &'a str,
}

#[derive(Debug, Deserialize)]
struct GhComment {
    id: u64,
    user: GhCommentUser,
    created_at: String,
    updated_at: String,
    body: Option<String>,
    html_url: String,
}

#[derive(Debug, Deserialize)]
struct GhCommentUser {
    login: String,
    avatar_url: String,
}

impl From<GhComment> for Comment {
    fn from(raw: GhComment) -> Self {
        Self {
            id: raw.id.to_string(),
            author: UserInfo {
                display_name: raw.user.login.clone(),
                login: raw.user.login,
                avatar_url: raw.user.avatar_url,
            },
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            body: raw.body.unwrap_or_default(),
            html_url: raw.html_url,
        }
    }
}
