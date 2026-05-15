// SPDX-License-Identifier: AGPL-3.0-or-later

//! Gitea / Forgejo repo-metadata endpoints (REST v1) for the Create
//! Issue/PR dropdowns. Labels + milestones surface as numeric IDs;
//! collaborators surface as usernames (Gitea accepts those directly).

use reqwest::Method;
use serde::Deserialize;

use crate::backend::BackendError;

use super::super::http::{self, GITEA_QUIRKS};
use super::super::types::Identifier;
use super::api_base;

pub async fn list_labels(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<Identifier>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/labels?limit=50");
    let raw: Vec<GiteaLabel> = get_json(token, &url).await?;
    Ok(raw.into_iter().map(Identifier::from).collect())
}

pub async fn list_collaborators(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<Identifier>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/collaborators?limit=50");
    let raw: Vec<GiteaUser> = get_json(token, &url).await?;
    Ok(raw.into_iter().map(Identifier::from).collect())
}

pub async fn list_milestones(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<Identifier>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/milestones?state=open&limit=50");
    let raw: Vec<GiteaMilestone> = get_json(token, &url).await?;
    Ok(raw.into_iter().map(Identifier::from).collect())
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
        .map_err(|e| http::decode_error("decoding repo-metadata response", e))
}

#[derive(Debug, Deserialize)]
struct GiteaLabel {
    id: u64,
    name: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct GiteaUser {
    login: String,
    full_name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GiteaMilestone {
    id: u64,
    title: String,
}

impl From<GiteaLabel> for Identifier {
    fn from(raw: GiteaLabel) -> Self {
        Self {
            id: raw.id.to_string(),
            display_name: raw.name,
            avatar_url: String::new(),
            color: raw.color.trim_start_matches('#').to_string(),
        }
    }
}

impl From<GiteaUser> for Identifier {
    fn from(raw: GiteaUser) -> Self {
        Self {
            id: raw.login.clone(),
            display_name: raw.full_name.unwrap_or_else(|| raw.login.clone()),
            avatar_url: raw.avatar_url.unwrap_or_default(),
            color: String::new(),
        }
    }
}

impl From<GiteaMilestone> for Identifier {
    fn from(raw: GiteaMilestone) -> Self {
        Self {
            id: raw.id.to_string(),
            display_name: raw.title,
            avatar_url: String::new(),
            color: String::new(),
        }
    }
}
