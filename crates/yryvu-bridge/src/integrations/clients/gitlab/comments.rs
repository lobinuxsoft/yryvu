// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitLab notes (issue + MR comments) via REST v4. Issues and merge
//! requests have separate endpoints — pick by `CommentTarget`.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::super::http::{self, GITLAB_QUIRKS};
use super::super::types::{Comment, CommentTarget, CreateCommentInput, UserInfo};

fn rest_base(hostname: Option<&str>) -> Result<String, BackendError> {
    match hostname {
        None => Ok("https://gitlab.com/api/v4".to_string()),
        Some(h) => {
            let trimmed = h.trim_end_matches('/');
            if trimmed.is_empty() {
                return Err(BackendError::NetworkError {
                    detail: "empty hostname for self-hosted GitLab".to_string(),
                });
            }
            Ok(format!("{trimmed}/api/v4"))
        }
    }
}

fn resource_segment(target: CommentTarget) -> &'static str {
    match target {
        CommentTarget::Issue => "issues",
        CommentTarget::PullRequest => "merge_requests",
    }
}

pub async fn list_comments(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    target: CommentTarget,
    iid: u64,
) -> Result<Vec<Comment>, BackendError> {
    let base = rest_base(hostname)?;
    let project = format!("{owner}%2F{repo}");
    let resource = resource_segment(target);
    // GitLab orders notes newest-first by default — flip with
    // sort=asc so the UI renders chronologically.
    let url = format!("{base}/projects/{project}/{resource}/{iid}/notes?per_page=100&sort=asc");
    let raw: Vec<GlNote> = get_json(token, &url).await?;
    // GitLab includes "system" notes (e.g. label changes) in the
    // notes feed; the UI cares about user-authored comments.
    Ok(raw
        .into_iter()
        .filter(|n| !n.system)
        .map(Comment::from)
        .collect())
}

pub async fn create_comment(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    target: CommentTarget,
    iid: u64,
    input: &CreateCommentInput,
) -> Result<Comment, BackendError> {
    let base = rest_base(hostname)?;
    let project = format!("{owner}%2F{repo}");
    let resource = resource_segment(target);
    let url = format!("{base}/projects/{project}/{resource}/{iid}/notes");
    let body = GlNoteBody { body: &input.body };
    let client = http::client()?;
    let req = http::authed(&client, Method::POST, &url, token, "application/json").json(&body);
    let resp = http::execute(req, GITLAB_QUIRKS).await?;
    let raw: GlNote = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding POST /notes response", e))?;
    Ok(Comment::from(raw))
}

async fn get_json<T: serde::de::DeserializeOwned>(
    token: &str,
    url: &str,
) -> Result<T, BackendError> {
    let client = http::client()?;
    let req = http::authed(&client, Method::GET, url, token, "application/json");
    let resp = http::execute(req, GITLAB_QUIRKS).await?;
    resp.json()
        .await
        .map_err(|e| http::decode_error("decoding /notes response", e))
}

#[derive(Debug, Serialize)]
struct GlNoteBody<'a> {
    body: &'a str,
}

#[derive(Debug, Deserialize)]
struct GlNote {
    id: u64,
    author: GlNoteAuthor,
    created_at: String,
    updated_at: String,
    body: Option<String>,
    #[serde(default)]
    system: bool,
}

#[derive(Debug, Deserialize)]
struct GlNoteAuthor {
    username: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

impl From<GlNote> for Comment {
    fn from(raw: GlNote) -> Self {
        Self {
            id: raw.id.to_string(),
            author: UserInfo {
                display_name: raw
                    .author
                    .name
                    .unwrap_or_else(|| raw.author.username.clone()),
                login: raw.author.username,
                avatar_url: raw.author.avatar_url.unwrap_or_default(),
            },
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            body: raw.body.unwrap_or_default(),
            html_url: String::new(),
        }
    }
}
