// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitLab MR detail endpoints powering the 4-tab `PullRequestDetailPanel`
//! over GitLab. Mirrors [`super::super::github::detail`] with the
//! GitLab API quirks (GraphQL for detail, REST v4 for commits / files
//! / pipelines / state mutation).
//!
//! Returns the shared cross-provider types — the frontend panel
//! doesn't branch on provider.

use reqwest::Method;
use serde_json::json;

use crate::backend::BackendError;

use super::super::github::{CheckRun, PrCommit, PrFile, PullRequestDetail};
use super::super::http::{self, GITLAB_QUIRKS};
use super::detail_raw::{GlChangesResp, GlCommit, GlDetailResp, GlPipeline};
use super::graphql_endpoint;

/// REST v4 base URL — used by the commits / files / pipelines / state
/// endpoints. GraphQL lives at [`graphql_endpoint`] and powers the
/// detail fetch.
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

/// Encoded `owner/repo` project path — GitLab routes everything via
/// the URL-encoded full path because the project ID can also be a
/// numeric primary key.
fn project_path(owner: &str, repo: &str) -> String {
    format!("{owner}%2F{repo}")
}

/// GraphQL document for the detail tab. One round-trip covers body,
/// mergeability, approval state, head pipeline + author/labels/etc.
const DETAIL_QUERY: &str = "query($fullPath: ID!, $iid: String!) { \
    project(fullPath: $fullPath) { mergeRequest(iid: $iid) { \
        iid title description state draft webUrl createdAt updatedAt \
        targetBranch sourceBranch sha mergeStatus mergeableDiscussionsState \
        userNotesCount diffStatsSummary { additions deletions fileCount } \
        author { username name avatarUrl } \
        labels { nodes { title color } } \
        assignees { nodes { username name avatarUrl } } \
        reviewers { nodes { username name avatarUrl } } \
        milestone { title } \
        approvalsRequired approvalsLeft \
        headPipeline { status } \
        closedAt mergedAt \
    } } }";

/// Fetch the full MR record via GraphQL. Single round-trip, all the
/// fields the four tabs need (body, mergeable*, approvals,
/// headPipeline, counts).
pub async fn get_mr_detail(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    iid: u64,
) -> Result<PullRequestDetail, BackendError> {
    let endpoint = graphql_endpoint(hostname)?;
    let client = http::client()?;
    let req =
        http::authed(&client, Method::POST, &endpoint, token, "application/json").json(&json!({
            "query": DETAIL_QUERY,
            "variables": { "fullPath": format!("{owner}/{repo}"), "iid": iid.to_string() }
        }));
    let resp = http::execute(req, GITLAB_QUIRKS).await?;
    let body: GlDetailResp = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /graphql detail response", e))?;
    if let Some(errors) = body.errors {
        if !errors.is_empty() {
            return Err(BackendError::NetworkError {
                detail: format!(
                    "GraphQL errors: {}",
                    errors
                        .iter()
                        .map(|e| e.message.as_str())
                        .collect::<Vec<_>>()
                        .join("; ")
                ),
            });
        }
    }
    let mr = body
        .data
        .and_then(|d| d.project)
        .and_then(|p| p.merge_request)
        .ok_or(BackendError::NetworkError {
            detail: format!("MR !{iid} not found in {owner}/{repo}"),
        })?;
    Ok(mr.into())
}

pub async fn list_mr_commits(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    iid: u64,
) -> Result<Vec<PrCommit>, BackendError> {
    let base = rest_base(hostname)?;
    let path = project_path(owner, repo);
    let url = format!("{base}/projects/{path}/merge_requests/{iid}/commits?per_page=100");
    let client = http::client()?;
    let req = http::authed(&client, Method::GET, &url, token, "application/json");
    let resp = http::execute(req, GITLAB_QUIRKS).await?;
    let raw: Vec<GlCommit> = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /commits response", e))?;
    Ok(raw.into_iter().map(PrCommit::from).collect())
}

pub async fn list_mr_files(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    iid: u64,
) -> Result<Vec<PrFile>, BackendError> {
    let base = rest_base(hostname)?;
    let path = project_path(owner, repo);
    let url = format!("{base}/projects/{path}/merge_requests/{iid}/changes");
    let client = http::client()?;
    let req = http::authed(&client, Method::GET, &url, token, "application/json");
    let resp = http::execute(req, GITLAB_QUIRKS).await?;
    let body: GlChangesResp = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /changes response", e))?;
    Ok(body.changes.into_iter().map(PrFile::from).collect())
}

pub async fn list_mr_pipelines(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    iid: u64,
) -> Result<Vec<CheckRun>, BackendError> {
    let base = rest_base(hostname)?;
    let path = project_path(owner, repo);
    let url = format!("{base}/projects/{path}/merge_requests/{iid}/pipelines?per_page=50");
    let client = http::client()?;
    let req = http::authed(&client, Method::GET, &url, token, "application/json");
    let resp = http::execute(req, GITLAB_QUIRKS).await?;
    let raw: Vec<GlPipeline> = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding /pipelines response", e))?;
    Ok(raw.into_iter().map(CheckRun::from).collect())
}

/// Action verb routed by [`mr_action`] to the appropriate REST PUT.
/// GitLab uses a single `PUT /merge_requests/:iid` with different
/// payload fields (`state_event` for close/reopen, the canonical
/// `Draft:` title prefix or the modern `draft` boolean for draft
/// toggling).
#[derive(Debug, Clone, Copy)]
pub enum MrAction {
    Close,
    Reopen,
    ConvertToDraft,
    MarkReadyForReview,
}

impl MrAction {
    fn body(self) -> serde_json::Value {
        match self {
            Self::Close => json!({ "state_event": "close" }),
            Self::Reopen => json!({ "state_event": "reopen" }),
            // GitLab honours both the `Draft:` title prefix and a
            // `draft` boolean as of 14.1; the boolean is canonical.
            Self::ConvertToDraft => json!({ "draft": true }),
            Self::MarkReadyForReview => json!({ "draft": false }),
        }
    }
}

pub async fn mr_action(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    iid: u64,
    action: MrAction,
) -> Result<PullRequestDetail, BackendError> {
    let base = rest_base(hostname)?;
    let path = project_path(owner, repo);
    let url = format!("{base}/projects/{path}/merge_requests/{iid}");
    let client = http::client()?;
    let req =
        http::authed(&client, Method::PUT, &url, token, "application/json").json(&action.body());
    let _ = http::execute(req, GITLAB_QUIRKS).await?;
    // REST returns the post-mutation MR but the GraphQL detail shape
    // is what the panel renders; re-fetch via GraphQL so the response
    // shape is identical to the read-side path.
    get_mr_detail(token, hostname, owner, repo, iid).await
}
