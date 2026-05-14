// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub pull-request listing — walking-skeleton scope for #15.
//!
//! REST-only via `GET /repos/{owner}/{repo}/pulls?state=all&per_page=50`.
//! No filters DSL, no sort, no GraphQL for review/CI status — those
//! land in wave 2 of #15. The shape returned to the frontend is
//! intentionally flat so the row card can render with zero post-
//! processing.
//!
//! GitHub's REST PR list omits `user.name`; we surface `login` as the
//! display name to avoid a per-PR `/users/{login}` round-trip.
//! Wave 2 may upgrade to GraphQL where author display name is one
//! field on the same node.

use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::super::types::UserInfo;
use super::{api_base, USER_AGENT};

/// Resolved state of a pull request as surfaced to the UI.
///
/// GitHub's REST API only returns `state: "open" | "closed"` plus a
/// `merged_at` timestamp that's non-null when the PR was merged.
/// We collapse those two fields into a 3-way enum so the badge
/// component can render directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PullRequestState {
    Open,
    Closed,
    Merged,
}

/// Flat per-PR row payload — matches the `PullRequestBar` anatomy
/// in the GK bundle (title + number + author + state badge +
/// relative opened/updated time). camelCase serialization so the
/// frontend store can use the response object as-is.
///
/// Out of scope for v1 (wave 2 of #15):
/// - assignees / reviewers / labels chips
/// - review status (approved / changes-requested / pending)
/// - CI status (success / failure / pending)
/// - merge conflict indicator
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummary {
    pub number: u64,
    pub title: String,
    pub state: PullRequestState,
    pub draft: bool,
    pub author: UserInfo,
    /// ISO-8601 timestamp (e.g. `2024-01-15T18:24:09Z`). Frontend
    /// formats to "Opened 3 days ago" etc.
    pub created_at: String,
    /// ISO-8601 timestamp; tracks the latest activity (push, label,
    /// review, comment, etc).
    pub updated_at: String,
    /// Public-web URL of the PR. Used by "View in browser" actions.
    pub html_url: String,
    /// Target branch name (e.g. `main`).
    pub base_ref: String,
    /// Source branch name (e.g. `15-featgithub-pr-list-panel`).
    /// `head.label` (`owner:branch`) is dropped — wave 2 may surface
    /// it for cross-fork PRs.
    pub head_ref: String,
}

/// Raw shape of one entry in GitHub's `GET /repos/{owner}/{repo}/pulls`
/// response — only the fields we project into [`PullRequestSummary`].
#[derive(Debug, Deserialize)]
struct GhPull {
    number: u64,
    title: String,
    state: String,
    #[serde(default)]
    draft: bool,
    merged_at: Option<String>,
    user: GhPullUser,
    created_at: String,
    updated_at: String,
    html_url: String,
    base: GhPullRef,
    head: GhPullRef,
}

#[derive(Debug, Deserialize)]
struct GhPullUser {
    login: String,
    avatar_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GhPullRef {
    #[serde(rename = "ref")]
    ref_name: String,
}

fn project(raw: GhPull) -> PullRequestSummary {
    let state = if raw.merged_at.is_some() {
        PullRequestState::Merged
    } else if raw.state == "closed" {
        PullRequestState::Closed
    } else {
        PullRequestState::Open
    };
    PullRequestSummary {
        number: raw.number,
        title: raw.title,
        state,
        draft: raw.draft,
        author: UserInfo {
            display_name: raw.user.login.clone(),
            login: raw.user.login,
            avatar_url: raw.user.avatar_url,
        },
        created_at: raw.created_at,
        updated_at: raw.updated_at,
        html_url: raw.html_url,
        base_ref: raw.base.ref_name,
        head_ref: raw.head.ref_name,
    }
}

/// List pull requests for `owner/repo` from `token`'s vantage point.
///
/// REST `state=all` returns open + closed (incl. merged) in a single
/// page. We cap at 50 entries for v1 — pagination + sort + filters
/// land in wave 2.
pub async fn list_prs(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<PullRequestSummary>, BackendError> {
    let base = api_base(hostname)?;
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;
    let url = format!("{base}/repos/{owner}/{repo}/pulls?state=all&per_page=50");
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(BackendError::InvalidToken);
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        let remaining = resp
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        if remaining == Some(0) {
            let reset_at = resp
                .headers()
                .get("x-ratelimit-reset")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0);
            return Err(BackendError::RateLimited { reset_at });
        }
        return Err(BackendError::InvalidToken);
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(BackendError::NetworkError {
            detail: format!("repository {owner}/{repo} not found or token cannot see it"),
        });
    }
    if !status.is_success() {
        return Err(BackendError::NetworkError {
            detail: format!("unexpected HTTP {status} from GitHub /pulls"),
        });
    }

    let raw: Vec<GhPull> = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding /pulls response: {e}"),
    })?;
    Ok(raw.into_iter().map(project).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> GhPull {
        serde_json::from_str(json).expect("valid GhPull JSON")
    }

    #[test]
    fn project_open_pr() {
        let raw = parse(
            r#"{
            "number": 42,
            "title": "Add walking skeleton",
            "state": "open",
            "draft": false,
            "merged_at": null,
            "user": { "login": "lobinuxsoft", "avatar_url": "https://avatars.example/42" },
            "created_at": "2026-05-14T10:00:00Z",
            "updated_at": "2026-05-14T11:00:00Z",
            "html_url": "https://github.com/lobinuxsoft/yryvu/pull/42",
            "base": { "ref": "development" },
            "head": { "ref": "15-feat-pr-list" }
        }"#,
        );
        let summary = project(raw);
        assert_eq!(summary.number, 42);
        assert_eq!(summary.state, PullRequestState::Open);
        assert!(!summary.draft);
        assert_eq!(summary.author.login, "lobinuxsoft");
        assert_eq!(summary.author.display_name, "lobinuxsoft");
        assert_eq!(summary.base_ref, "development");
        assert_eq!(summary.head_ref, "15-feat-pr-list");
    }

    #[test]
    fn project_merged_pr_collapses_state() {
        // GitHub returns state="closed" + merged_at non-null for merged
        // PRs. We must surface that as Merged, not Closed.
        let raw = parse(
            r#"{
            "number": 100,
            "title": "Old feature",
            "state": "closed",
            "draft": false,
            "merged_at": "2026-05-10T12:00:00Z",
            "user": { "login": "octocat", "avatar_url": "https://avatars.example/octocat" },
            "created_at": "2026-05-01T10:00:00Z",
            "updated_at": "2026-05-10T12:00:00Z",
            "html_url": "https://github.com/owner/repo/pull/100",
            "base": { "ref": "main" },
            "head": { "ref": "f" }
        }"#,
        );
        let summary = project(raw);
        assert_eq!(summary.state, PullRequestState::Merged);
    }

    #[test]
    fn project_closed_without_merge() {
        let raw = parse(
            r#"{
            "number": 7,
            "title": "Abandoned",
            "state": "closed",
            "draft": false,
            "merged_at": null,
            "user": { "login": "octocat", "avatar_url": "x" },
            "created_at": "2026-05-01T10:00:00Z",
            "updated_at": "2026-05-02T10:00:00Z",
            "html_url": "x",
            "base": { "ref": "main" },
            "head": { "ref": "x" }
        }"#,
        );
        let summary = project(raw);
        assert_eq!(summary.state, PullRequestState::Closed);
    }

    #[test]
    fn project_draft_pr() {
        let raw = parse(
            r#"{
            "number": 5,
            "title": "WIP",
            "state": "open",
            "draft": true,
            "merged_at": null,
            "user": { "login": "x", "avatar_url": "x" },
            "created_at": "x",
            "updated_at": "x",
            "html_url": "x",
            "base": { "ref": "main" },
            "head": { "ref": "wip" }
        }"#,
        );
        let summary = project(raw);
        assert_eq!(summary.state, PullRequestState::Open);
        assert!(summary.draft);
    }

    #[test]
    fn project_missing_draft_defaults_false() {
        // GHE legacy responses may omit the `draft` field entirely.
        // serde(default) keeps draft = false in that case.
        let raw = parse(
            r#"{
            "number": 1,
            "title": "x",
            "state": "open",
            "merged_at": null,
            "user": { "login": "x", "avatar_url": "x" },
            "created_at": "x",
            "updated_at": "x",
            "html_url": "x",
            "base": { "ref": "main" },
            "head": { "ref": "x" }
        }"#,
        );
        let summary = project(raw);
        assert!(!summary.draft);
    }

    #[test]
    fn state_serializes_lowercase() {
        // Frontend store keys on the lowercase string variant.
        assert_eq!(
            serde_json::to_string(&PullRequestState::Open).unwrap(),
            "\"open\""
        );
        assert_eq!(
            serde_json::to_string(&PullRequestState::Merged).unwrap(),
            "\"merged\""
        );
        assert_eq!(
            serde_json::to_string(&PullRequestState::Closed).unwrap(),
            "\"closed\""
        );
    }
}
