// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub repo-metadata endpoints used to populate the Create
//! Issue/PR dropdowns: labels, collaborators, milestones. Same REST
//! base + auth header as the rest of the client.

use reqwest::Method;
use serde::Deserialize;

use crate::backend::BackendError;

use super::super::http::{self, GITHUB_QUIRKS};
use super::super::types::Identifier;
use super::api_base;

pub async fn list_labels(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<Identifier>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/labels?per_page=100");
    let raw: Vec<GhLabel> = get_json(token, &url).await?;
    Ok(raw.into_iter().map(Identifier::from).collect())
}

pub async fn list_collaborators(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<Identifier>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/collaborators?per_page=100");
    let raw: Vec<GhUser> = get_json(token, &url).await?;
    Ok(raw.into_iter().map(Identifier::from).collect())
}

pub async fn list_milestones(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<Identifier>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/milestones?state=open&per_page=100");
    let raw: Vec<GhMilestone> = get_json(token, &url).await?;
    Ok(raw.into_iter().map(Identifier::from).collect())
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
        .map_err(|e| http::decode_error("decoding repo-metadata response", e))
}

#[derive(Debug, Deserialize)]
struct GhLabel {
    name: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct GhUser {
    login: String,
    avatar_url: String,
}

#[derive(Debug, Deserialize)]
struct GhMilestone {
    number: u64,
    title: String,
}

impl From<GhLabel> for Identifier {
    fn from(raw: GhLabel) -> Self {
        Self {
            id: raw.name.clone(),
            display_name: raw.name,
            avatar_url: String::new(),
            color: raw.color,
        }
    }
}

impl From<GhUser> for Identifier {
    fn from(raw: GhUser) -> Self {
        Self {
            id: raw.login.clone(),
            display_name: raw.login,
            avatar_url: raw.avatar_url,
            color: String::new(),
        }
    }
}

impl From<GhMilestone> for Identifier {
    fn from(raw: GhMilestone) -> Self {
        Self {
            id: raw.number.to_string(),
            display_name: raw.title,
            avatar_url: String::new(),
            color: String::new(),
        }
    }
}
