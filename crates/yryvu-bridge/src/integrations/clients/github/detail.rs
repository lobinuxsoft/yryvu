// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub pull-request detail endpoints for the 4-tab detail panel
//! (#91): single-PR fetch, commits list, files-changed list, and
//! check-runs (CI tab). All REST; GraphQL would be one round-trip but
//! the REST shape carries every field the tabs need with explicit
//! pagination control (limit=100 covers virtually every PR; truly
//! enormous PRs fall back to a "diff truncated" hint in v1).

use reqwest::Method;
use serde::Serialize;

use crate::backend::BackendError;

use super::super::http::{self, GITHUB_QUIRKS};
use super::super::types::{Label, UserInfo};
use super::api_base;
use super::detail_raw::{GhCheckRun, GhCheckRunsResp, GhPrCommit, GhPrFile, GhPullDetail};
use super::prs::{CiStatus, PullRequestState, ReviewDecision};

/// Extended PR detail returned by [`get_pr_detail`] — superset of the
/// list-row `PullRequestSummary` with body, mergeability, and aggregate
/// counts the conversation/files/checks tabs need.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetail {
    pub number: u64,
    pub title: String,
    pub state: PullRequestState,
    pub draft: bool,
    pub author: UserInfo,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub merged_at: Option<String>,
    pub html_url: String,
    pub base_ref: String,
    pub head_ref: String,
    pub head_sha: String,
    /// Raw markdown body. Frontend renders via the shared markdown
    /// parser (XSS-safe block-tree pipeline reused from
    /// `ReleaseNotes/markdown.ts`).
    pub body: String,
    pub labels: Vec<Label>,
    pub assignees: Vec<UserInfo>,
    pub requested_reviewers: Vec<UserInfo>,
    pub milestone: Option<String>,
    /// `Some(true)` = mergeable, `Some(false)` = conflicting, `None`
    /// = GitHub still computing (will resolve on a subsequent poll).
    pub mergeable: Option<bool>,
    /// Verbose mergeability state — `clean`, `dirty`, `blocked`,
    /// `unstable`, `behind`, `has_hooks`, `unknown`. Surface as-is so
    /// the action-button cluster can disable Merge when not `clean`.
    pub mergeable_state: Option<String>,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub comments: u64,
    pub review_decision: Option<ReviewDecision>,
    pub ci_status: Option<CiStatus>,
}

/// Single commit in a PR's commit list (`GET /pulls/{n}/commits`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCommit {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub author: UserInfo,
    pub date: String,
}

/// Single file in a PR's files list (`GET /pulls/{n}/files`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFile {
    pub filename: String,
    /// `added` | `modified` | `removed` | `renamed` | `copied` |
    /// `changed` | `unchanged`.
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    /// Unified diff hunk text. Empty for binary files or when the
    /// patch is truncated past GitHub's 3000-line per-file limit.
    pub patch: Option<String>,
    /// Original filename when status == "renamed".
    pub previous_filename: Option<String>,
}

/// Single check run from the head-commit's check-runs endpoint
/// (`GET /commits/{sha}/check-runs`). Powers the Checks tab.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRun {
    pub name: String,
    /// `queued` | `in_progress` | `completed`.
    pub status: String,
    /// `success` | `failure` | `neutral` | `cancelled` | `skipped` |
    /// `timed_out` | `action_required`. `None` when status != completed.
    pub conclusion: Option<String>,
    pub details_url: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

/// Thin wrapper over [`http::execute`] — every detail endpoint is a
/// GET with the GitHub Accept header + standard quirks.
async fn get(url: &str, token: &str) -> Result<reqwest::Response, BackendError> {
    let client = http::client()?;
    let req = http::authed(
        &client,
        Method::GET,
        url,
        token,
        "application/vnd.github.v3+json",
    );
    http::execute(req, GITHUB_QUIRKS).await
}

/// Fetch the full PR record. Single REST round-trip; the response
/// carries body, mergeability, counts, and the same labels /
/// assignees / reviewers the list path returns.
pub async fn get_pr_detail(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<PullRequestDetail, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/pulls/{number}");
    let resp = get(&url, token).await?;
    let raw: GhPullDetail = resp
        .json()
        .await
        .map_err(|e| http::decode_error(&format!("decoding /pulls/{number} response"), e))?;
    Ok(project_detail(raw))
}

/// Fetch the commits attached to a PR. GitHub paginates at 250
/// commits max per PR — we request 100 per page once (covers the
/// vast majority); truly huge PRs would need follow-up pages, deferred.
pub async fn list_pr_commits(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<Vec<PrCommit>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/pulls/{number}/commits?per_page=100");
    let resp = get(&url, token).await?;
    let raw: Vec<GhPrCommit> = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /commits response", e))?;
    Ok(raw.into_iter().map(project_commit).collect())
}

/// Fetch the changed-files list for a PR. Returns up to 100 entries
/// (GitHub's hard cap is 3000 per page); patches above ~3MB are
/// truncated by GitHub and surface here with the `patch` field
/// silently shorter than the actual diff.
pub async fn list_pr_files(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<Vec<PrFile>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/pulls/{number}/files?per_page=100");
    let resp = get(&url, token).await?;
    let raw: Vec<GhPrFile> = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /files response", e))?;
    Ok(raw.into_iter().map(project_file).collect())
}

/// Fetch the check runs for a PR's head commit. The Checks tab
/// surfaces both classic statuses (deprecated upstream) and check
/// runs; we use the check-runs endpoint which subsumes both.
pub async fn list_pr_checks(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    head_sha: &str,
) -> Result<Vec<CheckRun>, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/commits/{head_sha}/check-runs?per_page=100");
    let resp = get(&url, token).await?;
    let raw: GhCheckRunsResp = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /check-runs response", e))?;
    Ok(raw.check_runs.into_iter().map(project_check).collect())
}

pub(super) fn project_detail(raw: GhPullDetail) -> PullRequestDetail {
    let state = if raw.merged_at.is_some() {
        PullRequestState::Merged
    } else if raw.state.as_deref() == Some("closed") {
        PullRequestState::Closed
    } else {
        PullRequestState::Open
    };
    let user = raw.user.unwrap_or_default();
    PullRequestDetail {
        number: raw.number.unwrap_or(0),
        title: raw.title.unwrap_or_default(),
        state,
        draft: raw.draft.unwrap_or(false),
        author: UserInfo {
            display_name: user.login.clone(),
            login: user.login,
            avatar_url: user.avatar_url,
        },
        created_at: raw.created_at.unwrap_or_default(),
        updated_at: raw.updated_at.unwrap_or_default(),
        closed_at: raw.closed_at,
        merged_at: raw.merged_at,
        html_url: raw.html_url.unwrap_or_default(),
        base_ref: raw
            .base
            .as_ref()
            .map(|b| b.ref_name.clone())
            .unwrap_or_default(),
        head_ref: raw
            .head
            .as_ref()
            .map(|h| h.ref_name.clone())
            .unwrap_or_default(),
        head_sha: raw.head.as_ref().map(|h| h.sha.clone()).unwrap_or_default(),
        body: raw.body.unwrap_or_default(),
        labels: raw
            .labels
            .unwrap_or_default()
            .into_iter()
            .map(|l| Label {
                name: l.name,
                color: l.color,
            })
            .collect(),
        assignees: raw
            .assignees
            .unwrap_or_default()
            .into_iter()
            .map(|u| UserInfo {
                display_name: u.login.clone(),
                login: u.login,
                avatar_url: u.avatar_url,
            })
            .collect(),
        requested_reviewers: raw
            .requested_reviewers
            .unwrap_or_default()
            .into_iter()
            .map(|u| UserInfo {
                display_name: u.login.clone(),
                login: u.login,
                avatar_url: u.avatar_url,
            })
            .collect(),
        milestone: raw.milestone.and_then(|m| m.title),
        mergeable: raw.mergeable,
        mergeable_state: raw.mergeable_state,
        additions: raw.additions.unwrap_or(0),
        deletions: raw.deletions.unwrap_or(0),
        changed_files: raw.changed_files.unwrap_or(0),
        comments: raw.comments.unwrap_or(0),
        // review_decision + ci_status are filled by the row's
        // enrichment pass — they aren't in the REST single-PR shape.
        // The frontend reuses whatever it already cached from the
        // list path; this defaults to None when the user opens detail
        // without first hovering the list.
        review_decision: None,
        ci_status: None,
    }
}

fn project_commit(raw: GhPrCommit) -> PrCommit {
    let sha = raw.sha.unwrap_or_default();
    let short_sha = sha.chars().take(7).collect();
    let commit = raw.commit.unwrap_or_default();
    let author_meta = commit.author.unwrap_or_default();
    // Prefer the GitHub user (avatar URL) when present; fall back to
    // the commit-time author metadata (`name` only, no avatar).
    let author = raw
        .author
        .map(|u| UserInfo {
            display_name: u.login.clone(),
            login: u.login,
            avatar_url: u.avatar_url,
        })
        .unwrap_or_else(|| UserInfo {
            display_name: author_meta.name.clone().unwrap_or_default(),
            login: author_meta.name.unwrap_or_default(),
            avatar_url: String::new(),
        });
    PrCommit {
        sha,
        short_sha,
        message: commit.message.unwrap_or_default(),
        author,
        date: author_meta.date.unwrap_or_default(),
    }
}

fn project_file(raw: GhPrFile) -> PrFile {
    PrFile {
        filename: raw.filename.unwrap_or_default(),
        status: raw.status.unwrap_or_default(),
        additions: raw.additions.unwrap_or(0),
        deletions: raw.deletions.unwrap_or(0),
        patch: raw.patch,
        previous_filename: raw.previous_filename,
    }
}

fn project_check(raw: GhCheckRun) -> CheckRun {
    CheckRun {
        name: raw.name.unwrap_or_default(),
        status: raw.status.unwrap_or_default(),
        conclusion: raw.conclusion,
        details_url: raw.details_url,
        started_at: raw.started_at,
        completed_at: raw.completed_at,
    }
}

#[cfg(test)]
#[path = "detail_tests.rs"]
mod tests;
