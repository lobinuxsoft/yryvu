// SPDX-License-Identifier: AGPL-3.0-or-later

//! Gitea / Forgejo issue listing via REST v1.
//!
//! `GET /api/v1/repos/{owner}/{repo}/issues?state=all&type=issues&limit=50`.
//! The `type=issues` filter excludes PRs (Gitea's `/issues` endpoint
//! returns both by default, similar to GitHub).

use reqwest::Method;
use serde::Deserialize;

use crate::backend::BackendError;

use super::super::http::{self, GITEA_QUIRKS};
use super::super::types::{IssueDetail, IssueState, IssueSummary, Label, UserInfo};
use super::api_base;

pub async fn list_issues(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<IssueSummary>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/issues?state=all&type=issues&limit=50&page=1");
    let client = http::client()?;
    let req = http::authed(&client, Method::GET, &url, token, "application/json");
    let resp = http::execute(req, GITEA_QUIRKS).await?;
    let raw: Vec<GiteaIssue> = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /issues response", e))?;
    Ok(raw.into_iter().map(IssueSummary::from).collect())
}

/// Fetch a single issue's full detail via REST v1. Gitea uses
/// `index` rather than `iid` (Gitea's pet name for the per-repo
/// number). Same status-code mapping as the list endpoint.
pub async fn get_issue_detail(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    index: u64,
) -> Result<IssueDetail, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/issues/{index}");
    let client = http::client()?;
    let req = http::authed(&client, Method::GET, &url, token, "application/json");
    let resp = http::execute(req, GITEA_QUIRKS).await?;
    let raw: GiteaIssueDetail = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /issues/{index} response", e))?;
    Ok(raw.into())
}

#[derive(Debug, Deserialize)]
struct GiteaIssue {
    number: u64,
    title: String,
    state: String,
    user: GiteaUser,
    created_at: String,
    updated_at: String,
    html_url: String,
    comments: u64,
    #[serde(default)]
    labels: Vec<GiteaLabel>,
    #[serde(default)]
    assignees: Vec<GiteaUser>,
}

#[derive(Debug, Deserialize, Clone)]
struct GiteaUser {
    login: String,
    full_name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GiteaLabel {
    name: String,
    color: String,
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

/// Gitea label colours come prefixed with `#`. Strip it to match the
/// canonical hex shape used by [`Label`] — same convention as the PR
/// adapter.
impl From<GiteaLabel> for Label {
    fn from(raw: GiteaLabel) -> Self {
        Self {
            name: raw.name,
            color: raw.color.trim_start_matches('#').to_string(),
        }
    }
}

impl From<GiteaIssue> for IssueSummary {
    fn from(raw: GiteaIssue) -> Self {
        let state = match raw.state.as_str() {
            "closed" => IssueState::Closed,
            _ => IssueState::Open,
        };
        Self {
            number: raw.number,
            title: raw.title,
            state,
            author: raw.user.into(),
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            html_url: raw.html_url,
            comments: raw.comments,
            labels: raw.labels.into_iter().map(Label::from).collect(),
            assignees: raw.assignees.into_iter().map(UserInfo::from).collect(),
        }
    }
}

/// Single-issue REST response — extends `GiteaIssue` with body +
/// closed_at + milestone.
#[derive(Debug, Deserialize)]
struct GiteaIssueDetail {
    number: u64,
    title: String,
    state: String,
    user: GiteaUser,
    created_at: String,
    updated_at: String,
    closed_at: Option<String>,
    html_url: String,
    comments: u64,
    body: Option<String>,
    milestone: Option<GiteaMilestoneMini>,
    #[serde(default)]
    labels: Vec<GiteaLabel>,
    #[serde(default)]
    assignees: Vec<GiteaUser>,
}

#[derive(Debug, Deserialize)]
struct GiteaMilestoneMini {
    title: Option<String>,
}

impl From<GiteaIssueDetail> for IssueDetail {
    fn from(raw: GiteaIssueDetail) -> Self {
        let state = match raw.state.as_str() {
            "closed" => IssueState::Closed,
            _ => IssueState::Open,
        };
        Self {
            number: raw.number,
            title: raw.title,
            state,
            author: raw.user.into(),
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            closed_at: raw.closed_at,
            html_url: raw.html_url,
            body: raw.body.unwrap_or_default(),
            milestone: raw.milestone.and_then(|m| m.title),
            comments: raw.comments,
            labels: raw.labels.into_iter().map(Label::from).collect(),
            assignees: raw.assignees.into_iter().map(UserInfo::from).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(json: &str) -> IssueSummary {
        let raw: GiteaIssue = serde_json::from_str(json).expect("valid GiteaIssue JSON");
        IssueSummary::from(raw)
    }

    #[test]
    fn project_open_issue() {
        let s = summary(
            r##"{
            "number": 7,
            "title": "Forgejo glitch",
            "state": "open",
            "user": { "login": "lobinuxsoft", "full_name": "Matias Galarza", "avatar_url": "x" },
            "created_at": "x",
            "updated_at": "x",
            "html_url": "https://codeberg.org/o/r/issues/7",
            "comments": 2,
            "labels": [{ "name": "bug", "color": "#d93f0b" }],
            "assignees": [{ "login": "alice" }]
        }"##,
        );
        assert_eq!(s.number, 7);
        assert_eq!(s.state, IssueState::Open);
        assert_eq!(s.author.display_name, "Matias Galarza");
        assert_eq!(s.labels[0].name, "bug");
        // Strip the leading `#` from the colour to match canonical hex shape.
        assert_eq!(s.labels[0].color, "d93f0b");
    }

    #[test]
    fn project_closed_issue() {
        let s = summary(
            r##"{
            "number": 1,
            "title": "x",
            "state": "closed",
            "user": { "login": "x" },
            "created_at": "x",
            "updated_at": "x",
            "html_url": "x",
            "comments": 0
        }"##,
        );
        assert_eq!(s.state, IssueState::Closed);
    }
}
