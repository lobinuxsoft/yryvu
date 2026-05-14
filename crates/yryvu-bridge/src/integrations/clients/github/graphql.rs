// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub GraphQL enrichment for the PR list — folds `reviewDecision`
//! and `statusCheckRollup.state` onto every [`PullRequestSummary`]
//! returned by the REST list call. One batched POST to `/graphql`
//! covers the whole list, avoiding N+1 REST round-trips.
//!
//! Aliases per PR (`pr42: pullRequest(number: 42) { ... }`) since
//! GraphQL forbids parameterising a field name; the response comes
//! back keyed by the same aliases.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::json;

use crate::backend::BackendError;

use super::{api_base, USER_AGENT};
use super::prs::{CiStatus, PullRequestSummary, ReviewDecision};

/// Fold review decision + CI rollup state onto each summary in
/// `prs`. No-op when the list is empty. Errors propagate as
/// [`BackendError`] — the caller decides whether to fail loudly or
/// keep the unenriched list (current callers fail loudly so users
/// notice degraded data instead of silently losing badges).
pub async fn enrich_prs(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    prs: &mut [PullRequestSummary],
) -> Result<(), BackendError> {
    if prs.is_empty() {
        return Ok(());
    }
    let base = api_base(hostname)?;
    // `/api/v3` is the REST root for GHE; GraphQL lives at `/api/graphql`
    // (per `<host>/api/v3` for REST + `<host>/api/graphql` for GraphQL,
    // per GHE docs). github.com keeps `/graphql` flat.
    let endpoint = if hostname.is_some() {
        // base is `<host>/api/v3`; rewrite to `<host>/api/graphql`.
        base.trim_end_matches("/api/v3").to_string() + "/api/graphql"
    } else {
        "https://api.github.com/graphql".to_string()
    };

    let query = build_query(owner, repo, prs.iter().map(|p| p.number));
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| BackendError::NetworkError {
            detail: e.to_string(),
        })?;
    let resp = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github.v3+json")
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
    if !status.is_success() {
        return Err(BackendError::NetworkError {
            detail: format!("unexpected HTTP {status} from GitHub GraphQL"),
        });
    }

    let body: GhGraphqlResp = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding /graphql response: {e}"),
    })?;
    // GraphQL spec: `errors` may coexist with partial `data`. We treat
    // any top-level error as a hard failure so the user sees the issue
    // instead of silently-blank badges on some rows.
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
    let prs_map = body
        .data
        .and_then(|d| d.repository)
        .map(|r| r.prs)
        .unwrap_or_default();
    fold_response(prs, &prs_map);
    Ok(())
}

/// Build the GraphQL document — one alias per PR. Numbers come from
/// an iterator so the caller doesn't have to clone the slice.
fn build_query(owner: &str, repo: &str, numbers: impl Iterator<Item = u64>) -> String {
    let mut body = String::with_capacity(512);
    body.push_str("query { repository(owner: \"");
    body.push_str(owner);
    body.push_str("\", name: \"");
    body.push_str(repo);
    body.push_str("\") {");
    for n in numbers {
        body.push_str(&format!(
            " pr{n}: pullRequest(number: {n}) {{ reviewDecision commits(last: 1) {{ nodes {{ commit {{ statusCheckRollup {{ state }} }} }} }} }}"
        ));
    }
    body.push_str(" } }");
    body
}

/// Mutate each `PullRequestSummary` in `prs` with the matching
/// alias's response. Missing alias → both fields stay `None`.
fn fold_response(prs: &mut [PullRequestSummary], by_alias: &HashMap<String, GhPrNode>) {
    for pr in prs.iter_mut() {
        let alias = format!("pr{}", pr.number);
        if let Some(node) = by_alias.get(&alias) {
            pr.review_decision = node.review_decision.as_deref().and_then(parse_review);
            pr.ci_status = node
                .commits
                .nodes
                .first()
                .and_then(|n| n.commit.status_check_rollup.as_ref())
                .and_then(|r| r.state.as_deref())
                .and_then(parse_ci);
        }
    }
}

fn parse_review(raw: &str) -> Option<ReviewDecision> {
    match raw {
        "APPROVED" => Some(ReviewDecision::Approved),
        "CHANGES_REQUESTED" => Some(ReviewDecision::ChangesRequested),
        "REVIEW_REQUIRED" => Some(ReviewDecision::ReviewRequired),
        _ => None,
    }
}

fn parse_ci(raw: &str) -> Option<CiStatus> {
    match raw {
        "SUCCESS" => Some(CiStatus::Success),
        "FAILURE" => Some(CiStatus::Failure),
        "PENDING" => Some(CiStatus::Pending),
        "ERROR" => Some(CiStatus::Error),
        "EXPECTED" => Some(CiStatus::Expected),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
struct GhGraphqlResp {
    #[serde(default)]
    data: Option<GhGraphqlData>,
    #[serde(default)]
    errors: Option<Vec<GhGraphqlError>>,
}

#[derive(Debug, Deserialize)]
struct GhGraphqlData {
    #[serde(default)]
    repository: Option<GhRepoNode>,
}

#[derive(Debug, Deserialize)]
struct GhRepoNode {
    #[serde(flatten)]
    prs: HashMap<String, GhPrNode>,
}

#[derive(Debug, Deserialize)]
struct GhPrNode {
    #[serde(rename = "reviewDecision")]
    review_decision: Option<String>,
    commits: GhCommits,
}

#[derive(Debug, Deserialize)]
struct GhCommits {
    nodes: Vec<GhCommitNode>,
}

#[derive(Debug, Deserialize)]
struct GhCommitNode {
    commit: GhCommit,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // fields read via field-access after serde construction
struct GhCommit {
    #[serde(rename = "statusCheckRollup")]
    status_check_rollup: Option<GhStatusCheckRollup>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // fields read via field-access after serde construction
struct GhStatusCheckRollup {
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // fields read via field-access after serde construction
struct GhGraphqlError {
    message: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::clients::types::UserInfo;
    use crate::integrations::clients::PullRequestState;

    fn dummy_pr(number: u64) -> PullRequestSummary {
        PullRequestSummary {
            number,
            title: "x".to_string(),
            state: PullRequestState::Open,
            draft: false,
            author: UserInfo {
                login: "x".to_string(),
                display_name: "x".to_string(),
                avatar_url: "x".to_string(),
            },
            created_at: "x".to_string(),
            updated_at: "x".to_string(),
            html_url: "x".to_string(),
            base_ref: "main".to_string(),
            head_ref: "x".to_string(),
            head_sha: "deadbeef".to_string(),
            labels: vec![],
            assignees: vec![],
            requested_reviewers: vec![],
            review_decision: None,
            ci_status: None,
        }
    }

    #[test]
    fn build_query_contains_alias_per_number() {
        let q = build_query("owner", "repo", [42u64, 100].into_iter());
        assert!(q.contains("pr42: pullRequest(number: 42)"));
        assert!(q.contains("pr100: pullRequest(number: 100)"));
        assert!(q.contains("repository(owner: \"owner\", name: \"repo\")"));
        assert!(q.contains("reviewDecision"));
        assert!(q.contains("statusCheckRollup"));
    }

    #[test]
    fn fold_response_populates_known_aliases() {
        let mut prs = vec![dummy_pr(42), dummy_pr(100), dummy_pr(7)];
        let map: HashMap<String, GhPrNode> = serde_json::from_value(serde_json::json!({
            "pr42": {
                "reviewDecision": "APPROVED",
                "commits": {
                    "nodes": [
                        { "commit": { "statusCheckRollup": { "state": "SUCCESS" } } }
                    ]
                }
            },
            "pr100": {
                "reviewDecision": null,
                "commits": {
                    "nodes": [
                        { "commit": { "statusCheckRollup": null } }
                    ]
                }
            }
        }))
        .unwrap();
        fold_response(&mut prs, &map);
        assert_eq!(prs[0].review_decision, Some(ReviewDecision::Approved));
        assert_eq!(prs[0].ci_status, Some(CiStatus::Success));
        assert_eq!(prs[1].review_decision, None);
        assert_eq!(prs[1].ci_status, None);
        // pr7 had no alias in the response → both fields stay None.
        assert_eq!(prs[2].review_decision, None);
        assert_eq!(prs[2].ci_status, None);
    }

    #[test]
    fn parse_review_handles_known_values_and_drops_unknown() {
        assert_eq!(parse_review("APPROVED"), Some(ReviewDecision::Approved));
        assert_eq!(
            parse_review("CHANGES_REQUESTED"),
            Some(ReviewDecision::ChangesRequested)
        );
        assert_eq!(
            parse_review("REVIEW_REQUIRED"),
            Some(ReviewDecision::ReviewRequired)
        );
        assert_eq!(parse_review("COMMENTED"), None);
        assert_eq!(parse_review("garbage"), None);
    }

    #[test]
    fn parse_ci_handles_all_five_states() {
        assert_eq!(parse_ci("SUCCESS"), Some(CiStatus::Success));
        assert_eq!(parse_ci("FAILURE"), Some(CiStatus::Failure));
        assert_eq!(parse_ci("PENDING"), Some(CiStatus::Pending));
        assert_eq!(parse_ci("ERROR"), Some(CiStatus::Error));
        assert_eq!(parse_ci("EXPECTED"), Some(CiStatus::Expected));
        assert_eq!(parse_ci("UNKNOWN"), None);
    }
}
