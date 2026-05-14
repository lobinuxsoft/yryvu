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

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::super::http::{self, GITHUB_QUIRKS};
use super::super::types::{Label, UserInfo};
use super::api_base;

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
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
    pub base_ref: String,
    pub head_ref: String,
    pub head_sha: String,
    #[serde(default)]
    pub labels: Vec<Label>,
    #[serde(default)]
    pub assignees: Vec<UserInfo>,
    #[serde(default)]
    pub requested_reviewers: Vec<UserInfo>,
    #[serde(default)]
    pub review_decision: Option<ReviewDecision>,
    #[serde(default)]
    pub ci_status: Option<CiStatus>,
}

/// Raw shape of one entry in GitHub's `GET /repos/{owner}/{repo}/pulls`
/// response — only the fields we project into [`PullRequestSummary`].
#[derive(Debug, Deserialize)]
pub(super) struct GhPull {
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) state: String,
    #[serde(default)]
    pub(super) draft: bool,
    pub(super) merged_at: Option<String>,
    pub(super) user: GhPullUser,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) html_url: String,
    pub(super) base: GhPullRef,
    pub(super) head: GhPullRef,
    #[serde(default)]
    pub(super) labels: Vec<GhLabel>,
    #[serde(default)]
    pub(super) assignees: Vec<GhPullUser>,
    #[serde(default)]
    pub(super) requested_reviewers: Vec<GhPullUser>,
}

#[derive(Debug, Deserialize, Clone)]
pub(super) struct GhPullUser {
    pub(super) login: String,
    pub(super) avatar_url: String,
}

impl From<GhPullUser> for UserInfo {
    fn from(raw: GhPullUser) -> Self {
        Self {
            display_name: raw.login.clone(),
            login: raw.login,
            avatar_url: raw.avatar_url,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct GhPullRef {
    #[serde(rename = "ref")]
    pub(super) ref_name: String,
    /// `#[serde(default)]` keeps tests that pre-date the wave-2
    /// head-sha field passing — GitHub's live API always returns
    /// this, so an empty value only ever comes from fixtures.
    #[serde(default)]
    pub(super) sha: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GhLabel {
    pub(super) name: String,
    pub(super) color: String,
}

impl From<GhLabel> for Label {
    fn from(raw: GhLabel) -> Self {
        Self {
            name: raw.name,
            color: raw.color,
        }
    }
}

impl From<GhPull> for PullRequestSummary {
    fn from(raw: GhPull) -> Self {
        let state = match (raw.merged_at.is_some(), raw.state.as_str()) {
            (true, _) => PullRequestState::Merged,
            (_, "closed") => PullRequestState::Closed,
            _ => PullRequestState::Open,
        };
        Self {
            number: raw.number,
            title: raw.title,
            state,
            draft: raw.draft,
            author: raw.user.into(),
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            html_url: raw.html_url,
            base_ref: raw.base.ref_name,
            head_ref: raw.head.ref_name,
            head_sha: raw.head.sha,
            labels: raw.labels.into_iter().map(Label::from).collect(),
            assignees: raw.assignees.into_iter().map(UserInfo::from).collect(),
            requested_reviewers: raw
                .requested_reviewers
                .into_iter()
                .map(UserInfo::from)
                .collect(),
            review_decision: None,
            ci_status: None,
        }
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
    let url = format!("{base}/repos/{owner}/{repo}/pulls?state=all&per_page=50");
    let client = http::client()?;
    let req = http::authed(
        &client,
        Method::GET,
        &url,
        token,
        "application/vnd.github.v3+json",
    );
    let resp = http::execute(req, GITHUB_QUIRKS).await?;
    let raw: Vec<GhPull> = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /pulls response", e))?;
    Ok(raw.into_iter().map(PullRequestSummary::from).collect())
}

#[cfg(test)]
#[path = "prs_tests.rs"]
mod tests;
