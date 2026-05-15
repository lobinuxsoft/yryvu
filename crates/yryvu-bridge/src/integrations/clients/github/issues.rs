// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub issue listing.
//!
//! REST via `GET /repos/{owner}/{repo}/issues?state=all&per_page=50`.
//! GitHub returns PRs alongside issues from this endpoint; the
//! response payload carries a `pull_request` object on PR rows, so
//! we filter those out client-side to keep `IssueSummary` truly
//! issue-only.

use reqwest::Method;
use serde::Deserialize;

use crate::backend::BackendError;

use super::super::http::{self, GITHUB_QUIRKS};
use super::super::types::{IssueDetail, IssueState, IssueSummary, Label, UserInfo};
use super::api_base;

/// List issues for `owner/repo`. PRs returned by the same endpoint
/// are filtered out by the presence of the `pull_request` field.
pub async fn list_issues(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<IssueSummary>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/issues?state=all&filter=all&per_page=50");
    let client = http::client()?;
    let req = http::authed(
        &client,
        Method::GET,
        &url,
        token,
        "application/vnd.github.v3+json",
    );
    let resp = http::execute(req, GITHUB_QUIRKS).await?;
    let raw: Vec<GhIssue> = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /issues response", e))?;
    Ok(raw
        .into_iter()
        .filter(|row| row.pull_request.is_none())
        .map(IssueSummary::from)
        .collect())
}

/// Fetch a single issue's full detail. Same status-code mapping as
/// the list endpoint via `GITHUB_QUIRKS`. Returns `IssueDetail` —
/// superset of `IssueSummary` with body markdown + closed_at +
/// milestone.
pub async fn get_issue_detail(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<IssueDetail, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/issues/{number}");
    let client = http::client()?;
    let req = http::authed(
        &client,
        Method::GET,
        &url,
        token,
        "application/vnd.github.v3+json",
    );
    let resp = http::execute(req, GITHUB_QUIRKS).await?;
    let raw: GhIssueDetail = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /issues/{n} response", e))?;
    Ok(raw.into())
}

#[derive(Debug, Deserialize)]
struct GhIssue {
    number: u64,
    title: String,
    state: String,
    user: GhIssueUser,
    created_at: String,
    updated_at: String,
    html_url: String,
    comments: u64,
    #[serde(default)]
    labels: Vec<GhIssueLabel>,
    #[serde(default)]
    assignees: Vec<GhIssueUser>,
    /// Marker GitHub adds when this row is actually a PR. We don't
    /// care about the contents — only its presence.
    #[serde(default)]
    pull_request: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Clone)]
struct GhIssueUser {
    login: String,
    avatar_url: String,
}

#[derive(Debug, Deserialize)]
struct GhIssueLabel {
    name: String,
    color: String,
}

impl From<GhIssueUser> for UserInfo {
    fn from(raw: GhIssueUser) -> Self {
        Self {
            display_name: raw.login.clone(),
            login: raw.login,
            avatar_url: raw.avatar_url,
        }
    }
}

impl From<GhIssueLabel> for Label {
    fn from(raw: GhIssueLabel) -> Self {
        Self {
            name: raw.name,
            color: raw.color,
        }
    }
}

impl From<GhIssue> for IssueSummary {
    fn from(raw: GhIssue) -> Self {
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

/// Single-issue REST response — superset of `GhIssue` with `body` +
/// `closed_at` + `milestone`. The other fields are shared so we
/// `#[serde(flatten)]` the common shape via re-deserialisation.
#[derive(Debug, Deserialize)]
struct GhIssueDetail {
    number: u64,
    title: String,
    state: String,
    user: GhIssueUser,
    created_at: String,
    updated_at: String,
    closed_at: Option<String>,
    html_url: String,
    comments: u64,
    body: Option<String>,
    milestone: Option<GhMilestoneMini>,
    #[serde(default)]
    labels: Vec<GhIssueLabel>,
    #[serde(default)]
    assignees: Vec<GhIssueUser>,
}

#[derive(Debug, Deserialize)]
struct GhMilestoneMini {
    title: Option<String>,
}

impl From<GhIssueDetail> for IssueDetail {
    fn from(raw: GhIssueDetail) -> Self {
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
        let raw: GhIssue = serde_json::from_str(json).expect("valid GhIssue JSON");
        IssueSummary::from(raw)
    }

    #[test]
    fn project_open_issue() {
        let s = summary(
            r#"{
            "number": 12,
            "title": "Render bug on F43",
            "state": "open",
            "user": { "login": "lobinuxsoft", "avatar_url": "https://avatar.example/m" },
            "created_at": "2026-05-14T10:00:00Z",
            "updated_at": "2026-05-14T11:00:00Z",
            "html_url": "https://github.com/o/r/issues/12",
            "comments": 4,
            "labels": [{ "name": "bug", "color": "d93f0b" }],
            "assignees": [{ "login": "alice", "avatar_url": "x" }]
        }"#,
        );
        assert_eq!(s.number, 12);
        assert_eq!(s.state, IssueState::Open);
        assert_eq!(s.author.login, "lobinuxsoft");
        assert_eq!(s.comments, 4);
        assert_eq!(s.labels[0].name, "bug");
        assert_eq!(s.assignees[0].login, "alice");
    }

    #[test]
    fn project_closed_issue() {
        let s = summary(
            r#"{
            "number": 1,
            "title": "x",
            "state": "closed",
            "user": { "login": "x", "avatar_url": "x" },
            "created_at": "x",
            "updated_at": "x",
            "html_url": "x",
            "comments": 0
        }"#,
        );
        assert_eq!(s.state, IssueState::Closed);
    }

    #[test]
    fn pr_marker_field_is_what_distinguishes_pr_from_issue() {
        // Sanity check: GhIssue deserialises both shapes; the
        // pull_request field is what the list call filters on.
        let raw: GhIssue = serde_json::from_value(serde_json::json!({
            "number": 1,
            "title": "PR not issue",
            "state": "open",
            "user": { "login": "x", "avatar_url": "x" },
            "created_at": "x",
            "updated_at": "x",
            "html_url": "x",
            "comments": 0,
            "pull_request": { "url": "https://api.github.com/repos/o/r/pulls/1" }
        }))
        .unwrap();
        assert!(raw.pull_request.is_some());
    }
}
