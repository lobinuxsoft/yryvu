// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitLab issue listing via REST v4. Unlike merge requests (which
//! use GraphQL for the inline review/CI badges), issues don't carry
//! provider-specific aggregate state — REST is the right tool.
//!
//! `GET /api/v4/projects/{owner}%2F{repo}/issues?per_page=50` —
//! GitLab requires the project path URL-encoded since the slash is
//! reserved.

use reqwest::Method;
use serde::Deserialize;

use crate::backend::BackendError;

use super::super::http::{self, GITLAB_QUIRKS};
use super::super::types::{IssueState, IssueSummary, Label, UserInfo};

/// Resolve the REST v4 base URL for issues. GraphQL handles MRs; the
/// REST API is what the `/issues` endpoint speaks fluently.
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

pub async fn list_issues(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<IssueSummary>, BackendError> {
    let base = rest_base(hostname)?;
    // GitLab's project path is URL-encoded — the slash is reserved
    // because the project ID can also be a numeric primary key.
    let project = format!("{owner}%2F{repo}");
    let url = format!("{base}/projects/{project}/issues?per_page=50&scope=all");
    let client = http::client()?;
    let req = http::authed(&client, Method::GET, &url, token, "application/json");
    let resp = http::execute(req, GITLAB_QUIRKS).await?;
    let raw: Vec<GlIssue> = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /issues response", e))?;
    Ok(raw.into_iter().map(IssueSummary::from).collect())
}

#[derive(Debug, Deserialize)]
struct GlIssue {
    iid: u64,
    title: String,
    state: String,
    author: GlUser,
    created_at: String,
    updated_at: String,
    web_url: String,
    user_notes_count: u64,
    #[serde(default)]
    labels: Vec<String>,
    #[serde(default)]
    assignees: Vec<GlUser>,
}

#[derive(Debug, Deserialize, Clone)]
struct GlUser {
    username: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

impl From<GlUser> for UserInfo {
    fn from(raw: GlUser) -> Self {
        Self {
            display_name: raw.name.unwrap_or_else(|| raw.username.clone()),
            login: raw.username,
            avatar_url: raw.avatar_url.unwrap_or_default(),
        }
    }
}

impl From<GlIssue> for IssueSummary {
    fn from(raw: GlIssue) -> Self {
        let state = match raw.state.as_str() {
            "closed" => IssueState::Closed,
            _ => IssueState::Open,
        };
        // GitLab's REST issue list returns labels as plain string
        // names (no colour). The colours live behind `?with_labels_details=true`
        // which is an extra round-trip; for the row chips we accept
        // the colour fallback (gray) until the user demands branded
        // labels on this surface.
        let labels = raw
            .labels
            .into_iter()
            .map(|name| Label {
                name,
                color: "808080".to_string(),
            })
            .collect();
        Self {
            number: raw.iid,
            title: raw.title,
            state,
            author: raw.author.into(),
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            html_url: raw.web_url,
            comments: raw.user_notes_count,
            labels,
            assignees: raw.assignees.into_iter().map(UserInfo::from).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(json: &str) -> IssueSummary {
        let raw: GlIssue = serde_json::from_str(json).expect("valid GlIssue JSON");
        IssueSummary::from(raw)
    }

    #[test]
    fn project_opened_maps_to_open() {
        let s = summary(
            r#"{
            "iid": 42,
            "title": "x",
            "state": "opened",
            "author": { "username": "x", "name": "X", "avatar_url": "x" },
            "created_at": "x",
            "updated_at": "x",
            "web_url": "https://gitlab.com/o/r/-/issues/42",
            "user_notes_count": 3
        }"#,
        );
        assert_eq!(s.number, 42);
        assert_eq!(s.state, IssueState::Open);
        assert_eq!(s.comments, 3);
    }

    #[test]
    fn project_closed_maps_to_closed() {
        let s = summary(
            r#"{
            "iid": 1,
            "title": "x",
            "state": "closed",
            "author": { "username": "x" },
            "created_at": "x",
            "updated_at": "x",
            "web_url": "x",
            "user_notes_count": 0
        }"#,
        );
        assert_eq!(s.state, IssueState::Closed);
    }

    #[test]
    fn project_labels_get_grey_fallback() {
        // REST `labels` are plain strings — colour requires a
        // follow-up call. We surface the names with a neutral grey
        // fill so the row layout still works.
        let s = summary(
            r#"{
            "iid": 1,
            "title": "x",
            "state": "opened",
            "author": { "username": "x" },
            "created_at": "x",
            "updated_at": "x",
            "web_url": "x",
            "user_notes_count": 0,
            "labels": ["bug", "backend"]
        }"#,
        );
        assert_eq!(s.labels.len(), 2);
        assert_eq!(s.labels[0].name, "bug");
        assert_eq!(s.labels[0].color, "808080");
    }

    #[test]
    fn rest_base_dot_com() {
        assert_eq!(rest_base(None).unwrap(), "https://gitlab.com/api/v4");
    }

    #[test]
    fn rest_base_self_hosted() {
        assert_eq!(
            rest_base(Some("https://gitlab.example.com/")).unwrap(),
            "https://gitlab.example.com/api/v4"
        );
    }
}
