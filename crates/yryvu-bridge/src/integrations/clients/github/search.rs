// SPDX-License-Identifier: AGPL-3.0-or-later

//! Filtered pull-request search via GitHub GraphQL.
//!
//! Used when the user types into the filter toolbar — the resulting
//! query is translated by [`super::dsl::to_github_search`] and sent
//! to GitHub's GraphQL `search` connection. The response already
//! includes `reviewDecision` + `statusCheckRollup.state`, so the
//! caller does NOT need a separate enrichment round-trip (unlike the
//! REST `list_prs` path).
//!
//! GraphQL endpoint matches [`super::graphql`]: `/graphql` on
//! github.com, `<host>/api/graphql` on GHE.

use reqwest::Method;
use serde::Deserialize;
use serde_json::json;

use crate::backend::BackendError;

use super::super::http::{self, GITHUB_QUIRKS};
use super::super::types::{Label, UserInfo};
use super::api_base;
use super::prs::{CiStatus, PullRequestState, PullRequestSummary, ReviewDecision};

/// Search pull requests matching `dsl` within `owner/repo`. `dsl` is
/// raw user-typed text — translation to GitHub search syntax happens
/// internally via [`super::dsl::to_github_search`]. Returns up to 50
/// PRs (GraphQL connection page size). The result is already
/// enriched (review/CI status filled in) — callers MUST NOT also
/// invoke [`super::graphql::enrich_prs`] on this output.
pub async fn search_prs(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    dsl: &str,
) -> Result<Vec<PullRequestSummary>, BackendError> {
    // `api_base` runs only to honour the same hostname validation as
    // the REST path — GraphQL lives at a parallel URL.
    let _ = api_base(hostname)?;
    let endpoint = match hostname {
        None => "https://api.github.com/graphql".to_string(),
        Some(h) => format!("{}/api/graphql", h.trim_end_matches('/')),
    };
    let q = super::dsl::to_github_search(owner, repo, dsl);
    let query = build_search_query(&q);

    let client = http::client()?;
    let req = http::authed(
        &client,
        Method::POST,
        &endpoint,
        token,
        "application/vnd.github.v3+json",
    )
    .json(&json!({ "query": query }));
    let resp = http::execute(req, GITHUB_QUIRKS).await?;
    let body: GhSearchResp = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding GraphQL search response", e))?;
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
    let nodes = body.data.map(|d| d.search.nodes).unwrap_or_default();
    Ok(nodes.into_iter().filter_map(project_node).collect())
}

/// Build the GraphQL query. The `search` connection returns mixed
/// types (issues + PRs); the `... on PullRequest { ... }` inline
/// fragment filters to PRs only and pulls every field we need to
/// build a [`PullRequestSummary`].
fn build_search_query(q: &str) -> String {
    // q is already validated by tokenise + to_github_search — it can
    // contain quote chars, so we JSON-escape it before embedding.
    let escaped = q.replace('\\', "\\\\").replace('"', "\\\"");
    format!(
        "query {{ search(query: \"{escaped}\", type: ISSUE, first: 50) {{ nodes {{ ... on PullRequest {{ \
         number title state isDraft url createdAt updatedAt \
         author {{ login avatarUrl }} \
         baseRefName headRefName headRefOid \
         labels(first: 10) {{ nodes {{ name color }} }} \
         assignees(first: 10) {{ nodes {{ login avatarUrl }} }} \
         reviewRequests(first: 10) {{ nodes {{ requestedReviewer {{ ... on User {{ login avatarUrl }} }} }} }} \
         reviewDecision \
         commits(last: 1) {{ nodes {{ commit {{ statusCheckRollup {{ state }} }} }} }} \
         }} }} }} }}"
    )
}

fn project_node(node: GhSearchPr) -> Option<PullRequestSummary> {
    // Search returns mixed types; non-PR matches deserialize all
    // fields as Option::None and we filter them out here.
    let author = node.author?;
    let state = match node.state.as_deref()? {
        "MERGED" => PullRequestState::Merged,
        "CLOSED" => PullRequestState::Closed,
        _ => PullRequestState::Open,
    };
    Some(PullRequestSummary {
        number: node.number?,
        title: node.title?,
        state,
        draft: node.is_draft.unwrap_or(false),
        author: UserInfo {
            display_name: author.login.clone(),
            login: author.login,
            avatar_url: author.avatar_url,
        },
        created_at: node.created_at.unwrap_or_default(),
        updated_at: node.updated_at.unwrap_or_default(),
        html_url: node.url.unwrap_or_default(),
        base_ref: node.base_ref_name.unwrap_or_default(),
        head_ref: node.head_ref_name.unwrap_or_default(),
        head_sha: node.head_ref_oid.unwrap_or_default(),
        labels: node
            .labels
            .map(|l| {
                l.nodes
                    .into_iter()
                    .map(|n| Label {
                        name: n.name,
                        color: n.color,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        assignees: node
            .assignees
            .map(|a| {
                a.nodes
                    .into_iter()
                    .map(|n| UserInfo {
                        display_name: n.login.clone(),
                        login: n.login,
                        avatar_url: n.avatar_url,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        requested_reviewers: node
            .review_requests
            .map(|r| {
                r.nodes
                    .into_iter()
                    .filter_map(|rr| rr.requested_reviewer)
                    .map(|u| UserInfo {
                        display_name: u.login.clone(),
                        login: u.login,
                        avatar_url: u.avatar_url,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        review_decision: node.review_decision.as_deref().and_then(|r| match r {
            "APPROVED" => Some(ReviewDecision::Approved),
            "CHANGES_REQUESTED" => Some(ReviewDecision::ChangesRequested),
            "REVIEW_REQUIRED" => Some(ReviewDecision::ReviewRequired),
            _ => None,
        }),
        ci_status: node
            .commits
            .and_then(|c| c.nodes.into_iter().next())
            .and_then(|n| n.commit.status_check_rollup)
            .and_then(|r| r.state)
            .and_then(|s| match s.as_str() {
                "SUCCESS" => Some(CiStatus::Success),
                "FAILURE" => Some(CiStatus::Failure),
                "PENDING" => Some(CiStatus::Pending),
                "ERROR" => Some(CiStatus::Error),
                "EXPECTED" => Some(CiStatus::Expected),
                _ => None,
            }),
    })
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GhSearchResp {
    #[serde(default)]
    data: Option<GhSearchData>,
    #[serde(default)]
    errors: Option<Vec<GhGraphqlError>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GhSearchData {
    search: GhSearchConnection,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GhSearchConnection {
    nodes: Vec<GhSearchPr>,
}

/// Inline-fragment shape: every field is `Option` because the
/// `search` connection also returns Issue nodes (without PR-specific
/// fields). `project_node` filters out non-PR matches by requiring
/// `author + number + title + state`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhSearchPr {
    number: Option<u64>,
    title: Option<String>,
    state: Option<String>,
    is_draft: Option<bool>,
    url: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    author: Option<GhSearchUser>,
    base_ref_name: Option<String>,
    head_ref_name: Option<String>,
    head_ref_oid: Option<String>,
    labels: Option<GhSearchLabels>,
    assignees: Option<GhSearchUsers>,
    review_requests: Option<GhSearchReviewRequests>,
    review_decision: Option<String>,
    commits: Option<GhSearchCommits>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhSearchUser {
    login: String,
    avatar_url: String,
}

#[derive(Debug, Deserialize)]
struct GhSearchLabels {
    nodes: Vec<GhSearchLabel>,
}

#[derive(Debug, Deserialize)]
struct GhSearchLabel {
    name: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct GhSearchUsers {
    nodes: Vec<GhSearchUser>,
}

#[derive(Debug, Deserialize)]
struct GhSearchReviewRequests {
    nodes: Vec<GhSearchReviewRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhSearchReviewRequest {
    requested_reviewer: Option<GhSearchUser>,
}

#[derive(Debug, Deserialize)]
struct GhSearchCommits {
    nodes: Vec<GhSearchCommitNode>,
}

#[derive(Debug, Deserialize)]
struct GhSearchCommitNode {
    commit: GhSearchCommit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhSearchCommit {
    status_check_rollup: Option<GhSearchRollup>,
}

#[derive(Debug, Deserialize)]
struct GhSearchRollup {
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GhGraphqlError {
    message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_search_query_includes_q_and_pr_fragment() {
        let q = build_search_query("is:pr repo:o/r author:foo");
        assert!(q.contains("is:pr repo:o/r author:foo"));
        assert!(q.contains("... on PullRequest"));
        assert!(q.contains("reviewDecision"));
        assert!(q.contains("statusCheckRollup"));
    }

    #[test]
    fn build_search_query_escapes_quotes() {
        let q = build_search_query("label:\"good first issue\"");
        // The escaped query embeds \" instead of raw "
        assert!(q.contains("label:\\\"good first issue\\\""));
    }

    #[test]
    fn project_node_skips_non_pr_nodes() {
        // An Issue node deserialises as a GhSearchPr with all PR-
        // specific fields = None. project_node must filter these out
        // by returning None.
        let issue: GhSearchPr = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(project_node(issue).is_none());
    }

    #[test]
    fn project_node_full_pr_yields_summary() {
        let raw: GhSearchPr = serde_json::from_value(serde_json::json!({
            "number": 42,
            "title": "wave-2",
            "state": "OPEN",
            "isDraft": false,
            "url": "https://github.com/o/r/pull/42",
            "createdAt": "2026-05-14T10:00:00Z",
            "updatedAt": "2026-05-14T11:00:00Z",
            "author": { "login": "lobinuxsoft", "avatarUrl": "https://avatars.example/lobinuxsoft" },
            "baseRefName": "development",
            "headRefName": "360-wave-2",
            "labels": { "nodes": [{ "name": "bug", "color": "d93f0b" }] },
            "assignees": { "nodes": [{ "login": "alice", "avatarUrl": "https://avatars.example/alice" }] },
            "reviewRequests": { "nodes": [{ "requestedReviewer": { "login": "bob", "avatarUrl": "https://avatars.example/bob" } }] },
            "reviewDecision": "APPROVED",
            "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "state": "SUCCESS" } } }] }
        }))
        .unwrap();
        let summary = project_node(raw).expect("PR node should project");
        assert_eq!(summary.number, 42);
        assert_eq!(summary.state, PullRequestState::Open);
        assert_eq!(summary.author.login, "lobinuxsoft");
        assert_eq!(summary.labels[0].name, "bug");
        assert_eq!(summary.assignees[0].login, "alice");
        assert_eq!(summary.requested_reviewers[0].login, "bob");
        assert_eq!(summary.review_decision, Some(ReviewDecision::Approved));
        assert_eq!(summary.ci_status, Some(CiStatus::Success));
    }

    #[test]
    fn project_node_handles_merged_state() {
        let raw: GhSearchPr = serde_json::from_value(serde_json::json!({
            "number": 1,
            "title": "x",
            "state": "MERGED",
            "isDraft": false,
            "author": { "login": "x", "avatarUrl": "x" }
        }))
        .unwrap();
        let summary = project_node(raw).unwrap();
        assert_eq!(summary.state, PullRequestState::Merged);
    }

    #[test]
    fn project_node_drops_review_request_without_user() {
        // Team-based review requests serialize with `requestedReviewer:
        // null` (the inline fragment `... on User` doesn't match).
        // Those entries should be filtered out instead of inserted as
        // blank UserInfo entries.
        let raw: GhSearchPr = serde_json::from_value(serde_json::json!({
            "number": 1,
            "title": "x",
            "state": "OPEN",
            "author": { "login": "x", "avatarUrl": "x" },
            "reviewRequests": {
                "nodes": [
                    { "requestedReviewer": { "login": "bob", "avatarUrl": "x" } },
                    { "requestedReviewer": null }
                ]
            }
        }))
        .unwrap();
        let summary = project_node(raw).unwrap();
        assert_eq!(summary.requested_reviewers.len(), 1);
        assert_eq!(summary.requested_reviewers[0].login, "bob");
    }
}
