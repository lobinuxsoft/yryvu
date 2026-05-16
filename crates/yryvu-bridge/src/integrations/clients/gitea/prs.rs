// SPDX-License-Identifier: AGPL-3.0-or-later

//! Gitea / Forgejo pull-request listing via REST v1. The list payload
//! returns labels + assignees + reviewers + state inline — same shape
//! as GitHub's REST `/pulls`. Review aggregate + CI rollup are NOT in
//! the REST shape and Gitea has no GraphQL, so we surface those as
//! `None` (the badge stays blank). Revisit if users push back.

use reqwest::Method;
use serde::Deserialize;

use crate::backend::BackendError;

use super::super::github::{PullRequestState, PullRequestSummary};
use super::super::http::{self, GITEA_QUIRKS};
use super::super::types::{Label, UserInfo};
use super::api_base;

/// List pull requests in `owner/repo`. Gitea's `state=all` returns
/// open + closed (incl. merged) — same semantics as GitHub.
pub async fn list_prs(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<PullRequestSummary>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/pulls?state=all&limit=50&page=1");
    let resp = get(&url, token).await?;
    let raw: Vec<GiteaPull> = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /pulls response", e))?;
    Ok(raw.into_iter().map(PullRequestSummary::from).collect())
}

/// Thin wrapper over [`http::execute`] reused by `super::search`.
pub(super) async fn get(url: &str, token: &str) -> Result<reqwest::Response, BackendError> {
    let client = http::client()?;
    let req = http::authed(&client, Method::GET, url, token, "application/json");
    http::execute(req, GITEA_QUIRKS).await
}

impl From<GiteaPull> for PullRequestSummary {
    fn from(raw: GiteaPull) -> Self {
        let state = match (raw.merged.unwrap_or(false), raw.state.as_deref()) {
            (true, _) => PullRequestState::Merged,
            (_, Some("closed")) => PullRequestState::Closed,
            _ => PullRequestState::Open,
        };
        let users = |xs: Option<Vec<GiteaUser>>| -> Vec<UserInfo> {
            xs.unwrap_or_default().into_iter().map(Into::into).collect()
        };
        let head = raw.head.as_ref();
        Self {
            number: raw.number.unwrap_or(0),
            title: raw.title.unwrap_or_default(),
            state,
            draft: raw.draft.unwrap_or(false),
            author: raw.user.unwrap_or_default().into(),
            created_at: raw.created_at.unwrap_or_default(),
            updated_at: raw.updated_at.unwrap_or_default(),
            html_url: raw.html_url.unwrap_or_default(),
            base_ref: raw
                .base
                .as_ref()
                .and_then(|b| b.ref_name.clone())
                .unwrap_or_default(),
            head_ref: head.and_then(|h| h.ref_name.clone()).unwrap_or_default(),
            head_sha: head.and_then(|h| h.sha.clone()).unwrap_or_default(),
            labels: raw
                .labels
                .unwrap_or_default()
                .into_iter()
                .map(Label::from)
                .collect(),
            assignees: users(raw.assignees),
            requested_reviewers: users(raw.requested_reviewers),
            // Gitea has no GraphQL — review aggregate + CI rollup
            // left blank in wave 1. Wave-2-style N+1 enrichment can
            // be added later if user demand justifies it.
            review_decision: None,
            ci_status: None,
        }
    }
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
/// canonical hex shape used by [`Label`].
impl From<GiteaLabel> for Label {
    fn from(raw: GiteaLabel) -> Self {
        Self {
            name: raw.name,
            color: raw.color.trim_start_matches('#').to_string(),
        }
    }
}

/// Raw shape of one entry in Gitea's `GET /repos/{owner}/{repo}/pulls`
/// response. `pub(super)` so the search variant can reuse the same
/// deserializer.
#[derive(Debug, Deserialize, Default)]
pub(super) struct GiteaPull {
    pub number: Option<u64>,
    pub title: Option<String>,
    pub state: Option<String>,
    #[serde(default)]
    pub draft: Option<bool>,
    pub merged: Option<bool>,
    pub user: Option<GiteaUser>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub html_url: Option<String>,
    pub base: Option<GiteaRef>,
    pub head: Option<GiteaRef>,
    #[serde(default)]
    pub labels: Option<Vec<GiteaLabel>>,
    #[serde(default)]
    pub assignees: Option<Vec<GiteaUser>>,
    #[serde(default)]
    pub requested_reviewers: Option<Vec<GiteaUser>>,
}

#[derive(Debug, Deserialize, Default)]
pub(super) struct GiteaUser {
    pub login: String,
    pub full_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GiteaRef {
    #[serde(rename = "ref")]
    pub ref_name: Option<String>,
    pub sha: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GiteaLabel {
    pub name: String,
    pub color: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> GiteaPull {
        serde_json::from_str(json).expect("valid GiteaPull JSON")
    }

    #[test]
    fn project_open_pr_basic() {
        let raw = parse(
            r##"{
            "number": 42,
            "title": "Add Gitea support",
            "state": "open",
            "draft": false,
            "merged": false,
            "user": { "login": "lobinuxsoft", "full_name": "Matias Galarza", "avatar_url": "https://avatars.example/m" },
            "created_at": "2026-05-14T10:00:00Z",
            "updated_at": "2026-05-14T11:00:00Z",
            "html_url": "https://codeberg.org/owner/repo/pulls/42",
            "base": { "ref": "main", "sha": "basesha" },
            "head": { "ref": "feat-gitea", "sha": "deadbeef" }
        }"##,
        );
        let summary = PullRequestSummary::from(raw);
        assert_eq!(summary.number, 42);
        assert_eq!(summary.state, PullRequestState::Open);
        assert_eq!(summary.author.login, "lobinuxsoft");
        assert_eq!(summary.author.display_name, "Matias Galarza");
        assert_eq!(summary.head_sha, "deadbeef");
        assert_eq!(summary.head_ref, "feat-gitea");
        assert_eq!(summary.base_ref, "main");
        assert!(summary.review_decision.is_none());
        assert!(summary.ci_status.is_none());
    }

    #[test]
    fn project_merged_pr_collapses_state() {
        // Gitea returns state="closed" + merged=true for merged PRs.
        let raw = parse(
            r##"{
            "number": 1,
            "state": "closed",
            "merged": true,
            "user": { "login": "x" }
        }"##,
        );
        let summary = PullRequestSummary::from(raw);
        assert_eq!(summary.state, PullRequestState::Merged);
    }

    #[test]
    fn project_closed_without_merge() {
        let raw = parse(
            r##"{
            "number": 1,
            "state": "closed",
            "merged": false,
            "user": { "login": "x" }
        }"##,
        );
        let summary = PullRequestSummary::from(raw);
        assert_eq!(summary.state, PullRequestState::Closed);
    }

    #[test]
    fn project_draft_keeps_open_state() {
        let raw = parse(
            r##"{
            "number": 1,
            "state": "open",
            "draft": true,
            "merged": false,
            "user": { "login": "x" }
        }"##,
        );
        let summary = PullRequestSummary::from(raw);
        assert_eq!(summary.state, PullRequestState::Open);
        assert!(summary.draft);
    }

    #[test]
    fn project_labels_strip_leading_hash() {
        let raw = parse(
            r##"{
            "number": 1,
            "state": "open",
            "user": { "login": "x" },
            "labels": [{ "name": "bug", "color": "#d93f0b" }]
        }"##,
        );
        let summary = PullRequestSummary::from(raw);
        assert_eq!(summary.labels[0].name, "bug");
        assert_eq!(summary.labels[0].color, "d93f0b");
    }

    #[test]
    fn project_assignees_and_reviewers() {
        let raw = parse(
            r##"{
            "number": 1,
            "state": "open",
            "user": { "login": "x" },
            "assignees": [{ "login": "alice", "avatar_url": "https://avatar.example/alice" }],
            "requested_reviewers": [{ "login": "bob" }, { "login": "carol" }]
        }"##,
        );
        let summary = PullRequestSummary::from(raw);
        assert_eq!(summary.assignees.len(), 1);
        assert_eq!(summary.assignees[0].login, "alice");
        assert_eq!(summary.requested_reviewers.len(), 2);
        assert_eq!(summary.requested_reviewers[1].login, "carol");
    }
}
