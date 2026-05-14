// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitLab merge-request listing via GraphQL. Returns
//! [`PullRequestSummary`] — yryvu's shared type, since GitKraken
//! doesn't fork the bundle strings between providers (only the
//! section header swaps "Pull Requests" ↔ "Merge Requests").
//!
//! The GraphQL `mergeRequests` connection returns labels, assignees,
//! reviewers, approval state, and head-pipeline status in one
//! round-trip — no enrichment step needed.

use serde::Deserialize;
use serde_json::json;

use crate::backend::BackendError;

use super::super::github::{CiStatus, PullRequestState, PullRequestSummary, ReviewDecision};
use super::super::types::{Label, UserInfo};
use super::{graphql_endpoint, USER_AGENT};

/// List merge requests in `owner/repo`. GitLab uses `fullPath` (e.g.
/// `gitlab-org/gitlab`) for the project lookup; we synthesise that
/// from yryvu's `(owner, repo)` pair.
pub async fn list_mrs(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<PullRequestSummary>, BackendError> {
    let endpoint = graphql_endpoint(hostname)?;
    let full_path = format!("{owner}/{repo}");
    let query = build_list_query(&full_path);

    let resp = post_graphql(&endpoint, token, &query).await?;
    let body: GlMrsResp = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding /graphql response: {e}"),
    })?;
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
    let nodes = body
        .data
        .and_then(|d| d.project)
        .map(|p| p.merge_requests.nodes)
        .unwrap_or_default();
    Ok(nodes.into_iter().map(project_node).collect())
}

/// Shared HTTP helper — also reused by `super::search`. Maps GitLab's
/// status codes to typed [`BackendError`] variants.
pub(super) async fn post_graphql(
    endpoint: &str,
    token: &str,
    query: &str,
) -> Result<reqwest::Response, BackendError> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;
    let resp = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .json(&json!({ "query": query }))
        .send()
        .await
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(BackendError::InvalidToken);
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let reset_at = resp
            .headers()
            .get("ratelimit-reset")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        return Err(BackendError::RateLimited { reset_at });
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        // GitLab tokens with `read_user` only (no `read_api`) hit
        // 403 on MR queries. Surface as InsufficientScopes so the
        // toast suggests granting `read_api`.
        return Err(BackendError::InsufficientScopes {
            granted: "unknown".to_string(),
            required: "read_api".to_string(),
        });
    }
    if !status.is_success() {
        return Err(BackendError::NetworkError {
            detail: format!("unexpected HTTP {status} from GitLab GraphQL"),
        });
    }
    Ok(resp)
}

fn build_list_query(full_path: &str) -> String {
    format!(
        "query {{ project(fullPath: \"{full_path}\") {{ mergeRequests(state: all, first: 50, sort: UPDATED_DESC) {{ nodes {{ {NODE_FIELDS} }} }} }} }}"
    )
}

/// Fields requested for every merge-request node. Kept in one place
/// so the search variant in `super::search` can reuse the same shape
/// (different filter args, same returned columns).
pub(super) const NODE_FIELDS: &str = "iid title state draft webUrl createdAt updatedAt \
     targetBranch sourceBranch sha \
     author { username name avatarUrl } \
     labels { nodes { title color } } \
     assignees { nodes { username name avatarUrl } } \
     reviewers { nodes { username name avatarUrl } } \
     approvalsRequired approvalsLeft approvedBy { nodes { username } } \
     headPipeline { status }";

pub(super) fn project_node(node: GlMrNode) -> PullRequestSummary {
    let state = match node.state.as_deref() {
        Some("merged") => PullRequestState::Merged,
        Some("closed") | Some("locked") => PullRequestState::Closed,
        _ => PullRequestState::Open,
    };
    let author = node.author.unwrap_or_default();
    PullRequestSummary {
        number: node.iid.and_then(|s| s.parse().ok()).unwrap_or(0),
        title: node.title.unwrap_or_default(),
        state,
        draft: node.draft.unwrap_or(false),
        author: gl_user_to_info(author),
        created_at: node.created_at.unwrap_or_default(),
        updated_at: node.updated_at.unwrap_or_default(),
        html_url: node.web_url.unwrap_or_default(),
        base_ref: node.target_branch.unwrap_or_default(),
        head_ref: node.source_branch.unwrap_or_default(),
        head_sha: node.sha.unwrap_or_default(),
        labels: node
            .labels
            .map(|l| {
                l.nodes
                    .into_iter()
                    .map(|n| Label {
                        name: n.title,
                        color: strip_hash(n.color),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        assignees: node
            .assignees
            .map(|a| a.nodes.into_iter().map(gl_user_to_info).collect())
            .unwrap_or_default(),
        requested_reviewers: node
            .reviewers
            .map(|r| r.nodes.into_iter().map(gl_user_to_info).collect())
            .unwrap_or_default(),
        review_decision: derive_review_decision(
            node.approvals_required,
            node.approvals_left,
            node.approved_by
                .as_ref()
                .map(|a| a.nodes.len())
                .unwrap_or(0),
        ),
        ci_status: node
            .head_pipeline
            .and_then(|p| p.status.as_deref().map(parse_ci))
            .unwrap_or(None),
    }
}

fn gl_user_to_info(raw: GlUser) -> UserInfo {
    UserInfo {
        display_name: raw.name.clone().unwrap_or_else(|| raw.username.clone()),
        login: raw.username,
        avatar_url: raw.avatar_url.unwrap_or_default(),
    }
}

/// GitLab returns label colours WITH the leading `#`; yryvu's
/// canonical Label shape stores them without (matching GitHub's REST
/// API). Strip it here so frontend CSS rules apply uniformly.
fn strip_hash(color: String) -> String {
    color.trim_start_matches('#').to_string()
}

/// Approximate GitHub-style [`ReviewDecision`] from GitLab's approval
/// model. GitLab has no first-class "changes requested" aggregate —
/// reviewers signal that via unresolved threads which don't surface
/// in this query, so the mapping collapses to two states:
///
/// - `Approved`: approvals were required AND have all been collected.
/// - `ReviewRequired`: approvals are required but some are still
///   missing.
/// - `None`: no approvals required (no review badge rendered).
fn derive_review_decision(
    required: Option<i32>,
    left: Option<i32>,
    _approved_count: usize,
) -> Option<ReviewDecision> {
    let required = required?;
    if required <= 0 {
        return None;
    }
    let left = left.unwrap_or(required);
    if left <= 0 {
        Some(ReviewDecision::Approved)
    } else {
        Some(ReviewDecision::ReviewRequired)
    }
}

/// Map GitLab's pipeline status enum onto yryvu's [`CiStatus`].
/// Status names match the official GraphQL enum (`SUCCESS`,
/// `FAILED`, ...) — uppercase because GitLab's enums are SCREAMING.
pub(super) fn parse_ci(raw: &str) -> Option<CiStatus> {
    match raw {
        "SUCCESS" => Some(CiStatus::Success),
        "FAILED" => Some(CiStatus::Failure),
        "PENDING" | "RUNNING" | "PREPARING" | "WAITING_FOR_RESOURCE" | "CREATED" => {
            Some(CiStatus::Pending)
        }
        // GitLab's "manual" and "scheduled" pipelines are pre-action
        // — closest to "expected" in the GitHub model.
        "MANUAL" | "SCHEDULED" => Some(CiStatus::Expected),
        // CANCELED, SKIPPED — surface nothing rather than mislead.
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GlMrsResp {
    #[serde(default)]
    data: Option<GlMrsData>,
    #[serde(default)]
    errors: Option<Vec<GlGraphqlError>>,
}

#[derive(Debug, Deserialize)]
struct GlMrsData {
    project: Option<GlProject>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlProject {
    merge_requests: GlMrConnection,
}

#[derive(Debug, Deserialize)]
struct GlMrConnection {
    nodes: Vec<GlMrNode>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct GlMrNode {
    pub iid: Option<String>,
    pub title: Option<String>,
    pub state: Option<String>,
    pub draft: Option<bool>,
    pub web_url: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub target_branch: Option<String>,
    pub source_branch: Option<String>,
    pub sha: Option<String>,
    pub author: Option<GlUser>,
    pub labels: Option<GlLabelConnection>,
    pub assignees: Option<GlUserConnection>,
    pub reviewers: Option<GlUserConnection>,
    pub approvals_required: Option<i32>,
    pub approvals_left: Option<i32>,
    pub approved_by: Option<GlUserConnection>,
    pub head_pipeline: Option<GlPipeline>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct GlUser {
    pub username: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlUserConnection {
    pub nodes: Vec<GlUser>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlLabelConnection {
    pub nodes: Vec<GlLabelNode>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlLabelNode {
    pub title: String,
    pub color: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlPipeline {
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(super) struct GlGraphqlError {
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_node(json: &str) -> GlMrNode {
        serde_json::from_str(json).expect("valid GlMrNode JSON")
    }

    #[test]
    fn project_opened_mr_basic_shape() {
        let raw = parse_node(
            r#"{
            "iid": "42",
            "title": "Add GitLab support",
            "state": "opened",
            "draft": false,
            "webUrl": "https://gitlab.com/owner/repo/-/merge_requests/42",
            "createdAt": "2026-05-14T10:00:00Z",
            "updatedAt": "2026-05-14T11:00:00Z",
            "targetBranch": "main",
            "sourceBranch": "feat-gitlab",
            "sha": "deadbeef",
            "author": { "username": "lobinuxsoft", "name": "Matias Galarza", "avatarUrl": "https://avatar.example/m" }
        }"#,
        );
        let summary = project_node(raw);
        assert_eq!(summary.number, 42);
        assert_eq!(summary.state, PullRequestState::Open);
        assert_eq!(summary.author.login, "lobinuxsoft");
        assert_eq!(summary.author.display_name, "Matias Galarza");
        assert_eq!(summary.head_sha, "deadbeef");
        assert_eq!(summary.base_ref, "main");
        assert_eq!(summary.head_ref, "feat-gitlab");
    }

    #[test]
    fn project_state_locked_collapses_to_closed() {
        let raw = parse_node(r#"{ "iid": "1", "state": "locked", "author": { "username": "x" } }"#);
        let summary = project_node(raw);
        assert_eq!(summary.state, PullRequestState::Closed);
    }

    #[test]
    fn project_state_merged() {
        let raw = parse_node(r#"{ "iid": "1", "state": "merged", "author": { "username": "x" } }"#);
        let summary = project_node(raw);
        assert_eq!(summary.state, PullRequestState::Merged);
    }

    #[test]
    fn project_labels_strips_hash() {
        let raw = parse_node(
            r##"{
            "iid": "1",
            "state": "opened",
            "author": { "username": "x" },
            "labels": { "nodes": [{ "title": "bug", "color": "#d93f0b" }] }
        }"##,
        );
        let summary = project_node(raw);
        assert_eq!(summary.labels[0].name, "bug");
        // The leading `#` from GitLab gets stripped to match yryvu's
        // canonical hex shape (no leading hash).
        assert_eq!(summary.labels[0].color, "d93f0b");
    }

    #[test]
    fn project_approval_state_required_but_unmet() {
        let raw = parse_node(
            r#"{
            "iid": "1",
            "state": "opened",
            "author": { "username": "x" },
            "approvalsRequired": 2,
            "approvalsLeft": 2,
            "approvedBy": { "nodes": [] }
        }"#,
        );
        let summary = project_node(raw);
        assert_eq!(
            summary.review_decision,
            Some(ReviewDecision::ReviewRequired)
        );
    }

    #[test]
    fn project_approval_state_all_collected() {
        let raw = parse_node(
            r#"{
            "iid": "1",
            "state": "opened",
            "author": { "username": "x" },
            "approvalsRequired": 1,
            "approvalsLeft": 0,
            "approvedBy": { "nodes": [{ "username": "alice" }] }
        }"#,
        );
        let summary = project_node(raw);
        assert_eq!(summary.review_decision, Some(ReviewDecision::Approved));
    }

    #[test]
    fn project_approval_state_none_required() {
        let raw = parse_node(
            r#"{
            "iid": "1",
            "state": "opened",
            "author": { "username": "x" },
            "approvalsRequired": 0
        }"#,
        );
        let summary = project_node(raw);
        // No approval rule configured → no badge surfaced.
        assert_eq!(summary.review_decision, None);
    }

    #[test]
    fn project_pipeline_status_mapping() {
        for (raw, expected) in [
            ("SUCCESS", Some(CiStatus::Success)),
            ("FAILED", Some(CiStatus::Failure)),
            ("PENDING", Some(CiStatus::Pending)),
            ("RUNNING", Some(CiStatus::Pending)),
            ("MANUAL", Some(CiStatus::Expected)),
            ("CANCELED", None),
            ("SKIPPED", None),
            ("garbage", None),
        ] {
            assert_eq!(parse_ci(raw), expected, "ci status {raw}");
        }
    }

    #[test]
    fn build_list_query_embeds_full_path() {
        let q = build_list_query("foo/bar");
        assert!(q.contains("project(fullPath: \"foo/bar\")"));
        assert!(q.contains("mergeRequests"));
        assert!(q.contains("headPipeline"));
    }
}
