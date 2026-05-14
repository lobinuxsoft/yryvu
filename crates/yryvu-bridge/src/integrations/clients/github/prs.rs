// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub pull-request listing.
//!
//! REST via `GET /repos/{owner}/{repo}/pulls?state=all&per_page=50`.
//! The list payload returns `labels[]`, `assignees[]`, and
//! `requested_reviewers[]` inline — no extra round-trip for chip
//! rendering. Review status + CI status are NOT in the REST shape;
//! they get folded on later by [`super::graphql::enrich_prs`] (#360).
//!
//! GitHub's REST PR list omits `user.name`; we surface `login` as the
//! display name to avoid a per-PR `/users/{login}` round-trip.

use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::super::types::{Label, UserInfo};
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

/// Resolved code-review status surfaced to the UI. Populated by the
/// GraphQL enrichment pass — REST `/pulls` doesn't carry it. `None`
/// when the PR has no required reviewers / no reviews / GraphQL
/// enrichment failed so the badge stays gracefully blank instead of
/// showing a misleading state.
///
/// Matches GitHub's `PullRequestReviewDecision` GraphQL enum:
/// `APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED`. `COMMENTED` and
/// `DISMISSED` are properties of individual reviews, not the
/// aggregate decision — they don't surface here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewDecision {
    Approved,
    ChangesRequested,
    ReviewRequired,
}

/// Resolved CI status — collapsed from GitHub's `statusCheckRollup`
/// shape (which itself blends classic status checks + the newer check
/// runs). `None` when the head commit has no checks at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CiStatus {
    Success,
    Failure,
    Pending,
    Error,
    Expected,
}

/// Flat per-PR row payload — matches the `PullRequestBar` anatomy in
/// the GK bundle (title + number + author + state badge + chip
/// clusters + review/CI badges + relative opened/updated time).
/// camelCase serialization so the frontend store can use the response
/// object as-is.
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
    /// Source branch name (e.g. `360-feat-wave-2`). `head.label`
    /// (`owner:branch`) is dropped — fold it back in if cross-fork
    /// PRs need owner attribution beyond the author avatar.
    pub head_ref: String,
    /// Head commit SHA, used by the "Go to in graph" context-menu
    /// action to navigate the commit graph to this PR's tip.
    pub head_sha: String,
    /// Labels applied to the PR (REST inline). Frontend renders the
    /// first 3 as chips + a `+N` overflow when there are more.
    #[serde(default)]
    pub labels: Vec<Label>,
    /// Assignees (REST inline). Avatar cluster — up to 3 visible +
    /// overflow.
    #[serde(default)]
    pub assignees: Vec<UserInfo>,
    /// Requested reviewers (REST inline). Avatar cluster — up to 3
    /// visible + overflow. Excludes reviewers who have already
    /// submitted a review (GitHub drops them from this list).
    #[serde(default)]
    pub requested_reviewers: Vec<UserInfo>,
    /// Code-review decision. `None` when GraphQL enrichment skipped
    /// or failed — badge renders blank.
    #[serde(default)]
    pub review_decision: Option<ReviewDecision>,
    /// CI rollup state. `None` when the head commit has no status
    /// checks or GraphQL enrichment skipped.
    #[serde(default)]
    pub ci_status: Option<CiStatus>,
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
    #[serde(default)]
    labels: Vec<GhLabel>,
    #[serde(default)]
    assignees: Vec<GhPullUser>,
    #[serde(default)]
    requested_reviewers: Vec<GhPullUser>,
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
    /// Tip SHA. `#[serde(default)]` keeps tests that pre-date the
    /// wave-2 head-sha field passing — GitHub's live API always
    /// returns this, so an empty value only ever comes from test
    /// fixtures that don't care about the SHA.
    #[serde(default)]
    sha: String,
}

/// GitHub's REST label shape. `color` is a 6-digit hex string without
/// the leading `#`. We drop `description` + `default` flag — the chip
/// only renders the name + colour.
#[derive(Debug, Deserialize)]
struct GhLabel {
    name: String,
    color: String,
}

fn gh_user_to_info(raw: GhPullUser) -> UserInfo {
    UserInfo {
        display_name: raw.login.clone(),
        login: raw.login,
        avatar_url: raw.avatar_url,
    }
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
        author: gh_user_to_info(raw.user),
        created_at: raw.created_at,
        updated_at: raw.updated_at,
        html_url: raw.html_url,
        base_ref: raw.base.ref_name,
        head_ref: raw.head.ref_name,
        head_sha: raw.head.sha,
        labels: raw
            .labels
            .into_iter()
            .map(|l| Label {
                name: l.name,
                color: l.color,
            })
            .collect(),
        assignees: raw.assignees.into_iter().map(gh_user_to_info).collect(),
        requested_reviewers: raw
            .requested_reviewers
            .into_iter()
            .map(gh_user_to_info)
            .collect(),
        review_decision: None,
        ci_status: None,
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
        // Missing label / assignee / reviewer arrays → serde(default)
        // gives empty Vec.
        assert!(summary.labels.is_empty());
        assert!(summary.assignees.is_empty());
        assert!(summary.requested_reviewers.is_empty());
        // Enrichment hasn't run yet → both badges blank.
        assert!(summary.review_decision.is_none());
        assert!(summary.ci_status.is_none());
    }

    #[test]
    fn project_with_labels_and_chips() {
        let raw = parse(
            r#"{
            "number": 360,
            "title": "wave-2",
            "state": "open",
            "draft": false,
            "merged_at": null,
            "user": { "login": "x", "avatar_url": "x" },
            "created_at": "x",
            "updated_at": "x",
            "html_url": "x",
            "base": { "ref": "main" },
            "head": { "ref": "wave-2" },
            "labels": [
                { "name": "bug", "color": "d93f0b" },
                { "name": "wave-2", "color": "0e8a16" }
            ],
            "assignees": [
                { "login": "alice", "avatar_url": "https://avatars.example/alice" }
            ],
            "requested_reviewers": [
                { "login": "bob", "avatar_url": "https://avatars.example/bob" },
                { "login": "carol", "avatar_url": "https://avatars.example/carol" }
            ]
        }"#,
        );
        let summary = project(raw);
        assert_eq!(summary.labels.len(), 2);
        assert_eq!(summary.labels[0].name, "bug");
        assert_eq!(summary.labels[0].color, "d93f0b");
        assert_eq!(summary.assignees.len(), 1);
        assert_eq!(summary.assignees[0].login, "alice");
        assert_eq!(summary.requested_reviewers.len(), 2);
        assert_eq!(summary.requested_reviewers[1].login, "carol");
    }

    #[test]
    fn project_with_extra_label_fields_ignored() {
        // GitHub's REST returns more on labels (`id`, `description`,
        // `default`, `url`, etc). Our GhLabel deserialises only
        // `name`+`color`; serde drops the rest silently.
        let raw = parse(
            r#"{
            "number": 1,
            "title": "x",
            "state": "open",
            "draft": false,
            "merged_at": null,
            "user": { "login": "x", "avatar_url": "x" },
            "created_at": "x",
            "updated_at": "x",
            "html_url": "x",
            "base": { "ref": "main" },
            "head": { "ref": "x" },
            "labels": [
                { "id": 123, "name": "good first issue", "color": "7057ff", "description": "Beginner-friendly", "default": true, "url": "https://api.github.com/..." }
            ]
        }"#,
        );
        let summary = project(raw);
        assert_eq!(summary.labels.len(), 1);
        assert_eq!(summary.labels[0].name, "good first issue");
        assert_eq!(summary.labels[0].color, "7057ff");
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

    #[test]
    fn review_decision_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&ReviewDecision::Approved).unwrap(),
            "\"approved\""
        );
        assert_eq!(
            serde_json::to_string(&ReviewDecision::ChangesRequested).unwrap(),
            "\"changes_requested\""
        );
        assert_eq!(
            serde_json::to_string(&ReviewDecision::ReviewRequired).unwrap(),
            "\"review_required\""
        );
    }

    #[test]
    fn ci_status_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&CiStatus::Success).unwrap(),
            "\"success\""
        );
        assert_eq!(
            serde_json::to_string(&CiStatus::Failure).unwrap(),
            "\"failure\""
        );
        assert_eq!(
            serde_json::to_string(&CiStatus::Pending).unwrap(),
            "\"pending\""
        );
        assert_eq!(
            serde_json::to_string(&CiStatus::Error).unwrap(),
            "\"error\""
        );
        assert_eq!(
            serde_json::to_string(&CiStatus::Expected).unwrap(),
            "\"expected\""
        );
    }
}
