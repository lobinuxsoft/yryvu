// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub pull-request detail endpoints for the 4-tab detail panel
//! (#91): single-PR fetch, commits list, files-changed list, and
//! check-runs (CI tab). All REST; GraphQL would be one round-trip but
//! the REST shape carries every field the tabs need with explicit
//! pagination control (limit=100 covers virtually every PR; truly
//! enormous PRs fall back to a "diff truncated" hint in v1).

use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::super::types::{Label, UserInfo};
use super::prs::{CiStatus, PullRequestState, ReviewDecision};
use super::{api_base, USER_AGENT};

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

/// Action verb routed by [`pr_action`] to the appropriate REST mutation.
#[derive(Debug, Clone, Copy)]
pub enum PrAction {
    Close,
    Reopen,
    ConvertToDraft,
    MarkReadyForReview,
}

impl PrAction {
    fn body(self) -> serde_json::Value {
        match self {
            PrAction::Close => serde_json::json!({ "state": "closed" }),
            PrAction::Reopen => serde_json::json!({ "state": "open" }),
            PrAction::ConvertToDraft => serde_json::json!({ "draft": true }),
            PrAction::MarkReadyForReview => serde_json::json!({ "draft": false }),
        }
    }
}

/// Shared GET helper for the detail endpoints. Same status-code
/// mapping as `prs::list_prs` — Unauthorized / Rate-limited / 404 /
/// 5xx — but the URL is passed in so the caller controls pagination.
async fn get(url: &str, token: &str) -> Result<reqwest::Response, BackendError> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;
    let resp = client
        .get(url)
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
            detail: format!("not found or token cannot see it: {url}"),
        });
    }
    if !status.is_success() {
        return Err(BackendError::NetworkError {
            detail: format!("unexpected HTTP {status} from GitHub: {url}"),
        });
    }
    Ok(resp)
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
    let raw: GhPullDetail = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding /pulls/{number} response: {e}"),
    })?;
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
    let raw: Vec<GhPrCommit> = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding /commits response: {e}"),
    })?;
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
    let raw: Vec<GhPrFile> = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding /files response: {e}"),
    })?;
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
    let raw: GhCheckRunsResp = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding /check-runs response: {e}"),
    })?;
    Ok(raw.check_runs.into_iter().map(project_check).collect())
}

/// Apply a PR action via `PATCH /pulls/{number}`. Returns the
/// post-mutation PR detail so the frontend can refresh without an
/// extra GET.
pub async fn pr_action(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    number: u64,
    action: PrAction,
) -> Result<PullRequestDetail, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/pulls/{number}");
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;
    let resp = client
        .patch(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github.v3+json")
        .json(&action.body())
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
        // Most likely cause for 403 on PATCH: token has `read:*` but
        // not the write `repo` scope. Surface explicitly.
        return Err(BackendError::InsufficientScopes {
            granted: "read-only".to_string(),
            required: "repo (write)".to_string(),
        });
    }
    if !status.is_success() {
        return Err(BackendError::NetworkError {
            detail: format!("unexpected HTTP {status} from GitHub PATCH /pulls"),
        });
    }
    let raw: GhPullDetail = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding PATCH /pulls response: {e}"),
    })?;
    Ok(project_detail(raw))
}

fn project_detail(raw: GhPullDetail) -> PullRequestDetail {
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

#[derive(Debug, Deserialize, Default)]
struct GhPullDetail {
    number: Option<u64>,
    title: Option<String>,
    state: Option<String>,
    #[serde(default)]
    draft: Option<bool>,
    merged_at: Option<String>,
    closed_at: Option<String>,
    user: Option<GhUserMini>,
    created_at: Option<String>,
    updated_at: Option<String>,
    html_url: Option<String>,
    body: Option<String>,
    base: Option<GhRef>,
    head: Option<GhRef>,
    #[serde(default)]
    labels: Option<Vec<GhLabelMini>>,
    #[serde(default)]
    assignees: Option<Vec<GhUserMini>>,
    #[serde(default)]
    requested_reviewers: Option<Vec<GhUserMini>>,
    milestone: Option<GhMilestoneMini>,
    mergeable: Option<bool>,
    mergeable_state: Option<String>,
    additions: Option<u64>,
    deletions: Option<u64>,
    changed_files: Option<u64>,
    comments: Option<u64>,
}

#[derive(Debug, Deserialize, Default)]
struct GhUserMini {
    login: String,
    avatar_url: String,
}

#[derive(Debug, Deserialize)]
struct GhRef {
    #[serde(rename = "ref")]
    ref_name: String,
    sha: String,
}

#[derive(Debug, Deserialize)]
struct GhLabelMini {
    name: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct GhMilestoneMini {
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhPrCommit {
    sha: Option<String>,
    commit: Option<GhCommitInner>,
    author: Option<GhUserMini>,
}

#[derive(Debug, Deserialize, Default)]
struct GhCommitInner {
    message: Option<String>,
    author: Option<GhCommitAuthor>,
}

#[derive(Debug, Deserialize, Default)]
struct GhCommitAuthor {
    name: Option<String>,
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhPrFile {
    filename: Option<String>,
    status: Option<String>,
    additions: Option<u64>,
    deletions: Option<u64>,
    patch: Option<String>,
    previous_filename: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhCheckRunsResp {
    check_runs: Vec<GhCheckRun>,
}

#[derive(Debug, Deserialize)]
struct GhCheckRun {
    name: Option<String>,
    status: Option<String>,
    conclusion: Option<String>,
    details_url: Option<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_detail_open_pr_basic() {
        let raw: GhPullDetail = serde_json::from_value(serde_json::json!({
            "number": 91,
            "title": "Add detail view",
            "state": "open",
            "draft": false,
            "user": { "login": "lobinuxsoft", "avatar_url": "https://a/m" },
            "created_at": "2026-05-14T10:00:00Z",
            "updated_at": "2026-05-14T11:00:00Z",
            "html_url": "https://github.com/o/r/pull/91",
            "body": "Detail body here.",
            "base": { "ref": "development", "sha": "basesha" },
            "head": { "ref": "91-feat-detail", "sha": "headsha" },
            "additions": 1500,
            "deletions": 80,
            "changed_files": 42,
            "comments": 7,
            "mergeable": true,
            "mergeable_state": "clean",
        }))
        .unwrap();
        let d = project_detail(raw);
        assert_eq!(d.number, 91);
        assert_eq!(d.state, PullRequestState::Open);
        assert_eq!(d.body, "Detail body here.");
        assert_eq!(d.additions, 1500);
        assert_eq!(d.changed_files, 42);
        assert_eq!(d.mergeable, Some(true));
        assert_eq!(d.mergeable_state.as_deref(), Some("clean"));
    }

    #[test]
    fn project_detail_merged_state() {
        let raw: GhPullDetail = serde_json::from_value(serde_json::json!({
            "number": 1,
            "state": "closed",
            "merged_at": "2026-05-10T12:00:00Z",
            "user": { "login": "x", "avatar_url": "x" },
            "base": { "ref": "main", "sha": "x" },
            "head": { "ref": "f", "sha": "x" }
        }))
        .unwrap();
        let d = project_detail(raw);
        assert_eq!(d.state, PullRequestState::Merged);
        assert!(d.merged_at.is_some());
    }

    #[test]
    fn project_commit_short_sha_takes_first_7() {
        let raw: GhPrCommit = serde_json::from_value(serde_json::json!({
            "sha": "abcdef1234567890",
            "commit": {
                "message": "fix: thing",
                "author": { "name": "Alice", "date": "2026-05-14T10:00:00Z" }
            },
            "author": { "login": "alice", "avatar_url": "https://a/a" }
        }))
        .unwrap();
        let c = project_commit(raw);
        assert_eq!(c.short_sha, "abcdef1");
        assert_eq!(c.author.login, "alice");
        assert_eq!(c.message, "fix: thing");
    }

    #[test]
    fn project_commit_falls_back_to_commit_author_when_no_github_user() {
        // Commits authored by an email that doesn't map to a GitHub
        // user (synced via SSH push without GitHub identity) come
        // back with `author: null` — we surface the commit-time name.
        let raw: GhPrCommit = serde_json::from_value(serde_json::json!({
            "sha": "abc",
            "commit": {
                "message": "x",
                "author": { "name": "Anon", "date": "2026-05-14T10:00:00Z" }
            },
            "author": null
        }))
        .unwrap();
        let c = project_commit(raw);
        assert_eq!(c.author.login, "Anon");
        assert!(c.author.avatar_url.is_empty());
    }

    #[test]
    fn project_file_renamed_keeps_previous() {
        let raw: GhPrFile = serde_json::from_value(serde_json::json!({
            "filename": "new.rs",
            "previous_filename": "old.rs",
            "status": "renamed",
            "additions": 0,
            "deletions": 0,
            "patch": null
        }))
        .unwrap();
        let f = project_file(raw);
        assert_eq!(f.filename, "new.rs");
        assert_eq!(f.previous_filename.as_deref(), Some("old.rs"));
        assert_eq!(f.status, "renamed");
    }

    #[test]
    fn project_check_partial_completion() {
        let raw: GhCheckRun = serde_json::from_value(serde_json::json!({
            "name": "build",
            "status": "in_progress",
            "conclusion": null,
            "details_url": "https://gh/run/123",
            "started_at": "2026-05-14T10:00:00Z"
        }))
        .unwrap();
        let c = project_check(raw);
        assert_eq!(c.status, "in_progress");
        assert_eq!(c.conclusion, None);
        assert_eq!(c.details_url.as_deref(), Some("https://gh/run/123"));
    }

    #[test]
    fn pr_action_body_close() {
        let body = PrAction::Close.body();
        assert_eq!(body["state"], "closed");
    }

    #[test]
    fn pr_action_body_reopen() {
        let body = PrAction::Reopen.body();
        assert_eq!(body["state"], "open");
    }

    #[test]
    fn pr_action_body_convert_draft() {
        let body = PrAction::ConvertToDraft.body();
        assert_eq!(body["draft"], true);
    }

    #[test]
    fn pr_action_body_mark_ready() {
        let body = PrAction::MarkReadyForReview.body();
        assert_eq!(body["draft"], false);
    }
}
