// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitLab repo-metadata endpoints (REST v4) used to populate the
//! Create Issue/MR dropdowns. GitLab returns numeric IDs for labels +
//! users + milestones; we stringify them into [`Identifier::id`] so
//! the canonical IPC shape stays the same across providers.

use reqwest::Method;
use serde::Deserialize;

use crate::backend::BackendError;

use super::super::http::{self, GITLAB_QUIRKS};
use super::super::types::Identifier;

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

pub async fn list_labels(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<Identifier>, BackendError> {
    let base = rest_base(hostname)?;
    let project = format!("{owner}%2F{repo}");
    let url = format!("{base}/projects/{project}/labels?per_page=100");
    let raw: Vec<GlLabel> = get_json(token, &url).await?;
    Ok(raw.into_iter().map(Identifier::from).collect())
}

pub async fn list_collaborators(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<Identifier>, BackendError> {
    let base = rest_base(hostname)?;
    let project = format!("{owner}%2F{repo}");
    let url = format!("{base}/projects/{project}/members/all?per_page=100");
    let raw: Vec<GlUser> = get_json(token, &url).await?;
    Ok(raw.into_iter().map(Identifier::from).collect())
}

pub async fn list_milestones(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<Identifier>, BackendError> {
    let base = rest_base(hostname)?;
    let project = format!("{owner}%2F{repo}");
    let url = format!("{base}/projects/{project}/milestones?state=active&per_page=100");
    let raw: Vec<GlMilestone> = get_json(token, &url).await?;
    Ok(raw.into_iter().map(Identifier::from).collect())
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
        .map_err(|e| http::decode_error("decoding repo-metadata response", e))
}

#[derive(Debug, Deserialize)]
struct GlLabel {
    id: u64,
    name: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct GlUser {
    id: u64,
    username: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GlMilestone {
    id: u64,
    title: String,
}

impl From<GlLabel> for Identifier {
    fn from(raw: GlLabel) -> Self {
        Self {
            id: raw.id.to_string(),
            display_name: raw.name,
            avatar_url: String::new(),
            color: raw.color.trim_start_matches('#').to_string(),
        }
    }
}

impl From<GlUser> for Identifier {
    fn from(raw: GlUser) -> Self {
        Self {
            id: raw.id.to_string(),
            display_name: raw.name.unwrap_or(raw.username),
            avatar_url: raw.avatar_url.unwrap_or_default(),
            color: String::new(),
        }
    }
}

impl From<GlMilestone> for Identifier {
    fn from(raw: GlMilestone) -> Self {
        Self {
            id: raw.id.to_string(),
            display_name: raw.title,
            avatar_url: String::new(),
            color: String::new(),
        }
    }
}
