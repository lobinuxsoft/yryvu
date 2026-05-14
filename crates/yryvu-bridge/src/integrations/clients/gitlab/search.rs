// SPDX-License-Identifier: AGPL-3.0-or-later

//! Filtered merge-request search via GitLab GraphQL. Uses the same
//! `project.mergeRequests` connection as [`super::prs::list_mrs`] but
//! inlines the structured filter args derived from yryvu's DSL by
//! [`super::dsl::parse_filters`].

use std::fmt::Write;

use serde::Deserialize;

use crate::backend::BackendError;

use super::super::github::PullRequestSummary;
use super::dsl::{parse_filters, GitlabFilters};
use super::graphql_endpoint;
use super::prs::{post_graphql, project_node, GlMrNode, NODE_FIELDS};

/// Search merge requests in `owner/repo` matching `dsl`. `dsl` is
/// the raw user-typed text — parsing happens internally via
/// [`super::dsl::parse_filters`].
pub async fn search_mrs(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    dsl: &str,
) -> Result<Vec<PullRequestSummary>, BackendError> {
    let endpoint = graphql_endpoint(hostname)?;
    let full_path = format!("{owner}/{repo}");
    let filters = parse_filters(dsl);
    let query = build_search_query(&full_path, &filters);
    let resp = post_graphql(&endpoint, token, &query).await?;
    let body: GlSearchResp = resp.json().await.map_err(|e| BackendError::NetworkError {
        detail: format!("decoding /graphql search response: {e}"),
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

fn build_search_query(full_path: &str, f: &GitlabFilters) -> String {
    let mut args = format!(
        "state: {state}, first: 50, sort: UPDATED_DESC",
        state = f.state.as_deref().unwrap_or("all")
    );
    if let Some(v) = &f.author_username {
        let _ = write!(args, ", authorUsername: \"{}\"", escape(v));
    }
    if let Some(v) = &f.assignee_username {
        let _ = write!(args, ", assigneeUsername: \"{}\"", escape(v));
    }
    if let Some(v) = &f.reviewer_username {
        let _ = write!(args, ", reviewerUsername: \"{}\"", escape(v));
    }
    if !f.labels.is_empty() {
        let _ = write!(args, ", labels: [{}]", join_strings(&f.labels));
    }
    if let Some(v) = &f.milestone_title {
        let _ = write!(args, ", milestoneTitle: \"{}\"", escape(v));
    }
    if let Some(v) = f.draft {
        let _ = write!(args, ", draft: {v}");
    }
    if !f.source_branches.is_empty() {
        let _ = write!(
            args,
            ", sourceBranches: [{}]",
            join_strings(&f.source_branches)
        );
    }
    if !f.target_branches.is_empty() {
        let _ = write!(
            args,
            ", targetBranches: [{}]",
            join_strings(&f.target_branches)
        );
    }
    if let Some(v) = &f.search {
        let _ = write!(args, ", search: \"{}\"", escape(v));
    }
    format!(
        "query {{ project(fullPath: \"{path}\") {{ mergeRequests({args}) {{ nodes {{ {NODE_FIELDS} }} }} }} }}",
        path = escape(full_path)
    )
}

/// Inline a Rust `Vec<String>` as a GraphQL string-array literal:
/// `["a", "b"]`. Each element is escape-quoted.
fn join_strings(xs: &[String]) -> String {
    xs.iter()
        .map(|s| format!("\"{}\"", escape(s)))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Escape a string for inlining inside GraphQL double-quoted
/// literals. GraphQL accepts the same backslash-escape set as JSON
/// for our purposes (`\"` and `\\`).
fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GlSearchResp {
    #[serde(default)]
    data: Option<GlSearchData>,
    #[serde(default)]
    errors: Option<Vec<super::prs::GlGraphqlError>>,
}

#[derive(Debug, Deserialize)]
struct GlSearchData {
    project: Option<GlSearchProject>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlSearchProject {
    merge_requests: GlSearchConnection,
}

#[derive(Debug, Deserialize)]
struct GlSearchConnection {
    nodes: Vec<GlMrNode>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_query_default_filters() {
        let q = build_search_query("foo/bar", &GitlabFilters::default());
        assert!(q.contains("project(fullPath: \"foo/bar\")"));
        assert!(q.contains("state: all"));
        assert!(q.contains("first: 50"));
        // No optional filter args when filters is empty.
        assert!(!q.contains("authorUsername"));
        assert!(!q.contains("labels:"));
    }

    #[test]
    fn build_query_with_author_and_label() {
        let f = GitlabFilters {
            author_username: Some("foo".to_string()),
            labels: vec!["bug".to_string(), "backend".to_string()],
            state: Some("opened".to_string()),
            ..GitlabFilters::default()
        };
        let q = build_search_query("foo/bar", &f);
        assert!(q.contains("state: opened"));
        assert!(q.contains("authorUsername: \"foo\""));
        assert!(q.contains("labels: [\"bug\", \"backend\"]"));
    }

    #[test]
    fn build_query_escapes_quotes_in_search() {
        let f = GitlabFilters {
            search: Some("with \"quotes\"".to_string()),
            ..GitlabFilters::default()
        };
        let q = build_search_query("o/r", &f);
        // \" embedded inside the GraphQL string literal.
        assert!(q.contains("search: \"with \\\"quotes\\\"\""));
    }

    #[test]
    fn build_query_draft_bool_inlines() {
        let f = GitlabFilters {
            draft: Some(true),
            ..GitlabFilters::default()
        };
        let q = build_search_query("o/r", &f);
        assert!(q.contains("draft: true"));
    }

    #[test]
    fn build_query_branches_arrays() {
        let f = GitlabFilters {
            source_branches: vec!["feat-x".to_string()],
            target_branches: vec!["main".to_string(), "develop".to_string()],
            ..GitlabFilters::default()
        };
        let q = build_search_query("o/r", &f);
        assert!(q.contains("sourceBranches: [\"feat-x\"]"));
        assert!(q.contains("targetBranches: [\"main\", \"develop\"]"));
    }

    #[test]
    fn escape_handles_backslash_and_quote() {
        assert_eq!(escape("a\\b"), "a\\\\b");
        assert_eq!(escape("a\"b"), "a\\\"b");
    }
}
