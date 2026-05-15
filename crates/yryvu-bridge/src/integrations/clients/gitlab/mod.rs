// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitLab API client. Mirrors the GitHub client's submodule layout
//! ([`super::github`]) — each submodule owns one API surface and
//! stays under the 400 LOC cap for production code:
//!
//! - [`preflight`] — `currentUser` GraphQL query for token validation.
//! - [`prs`] — merge-request listing (GraphQL `project.mergeRequests`).
//! - [`dsl`] — filter DSL translation to GitLab GraphQL filter args.
//! - [`search`] — filtered MR search dispatch.
//!
//! GitLab's API is GraphQL-first for the surfaces yryvu needs — the
//! REST `/projects/:id/merge_requests` endpoint omits `head_pipeline`
//! and reviewer state by default, forcing an N+1 to fill the chips +
//! badges. The GraphQL `mergeRequests` connection returns all of
//! that in a single round-trip, matching the cost profile of the
//! GitHub side's REST + enrich pattern.

mod detail;
mod detail_raw;
mod dsl;
mod issues;
mod preflight;
mod prs;
mod search;

pub use detail::{
    get_mr_detail, list_mr_commits, list_mr_files, list_mr_pipelines, mr_action, MrAction,
};
pub use issues::{get_issue_detail, list_issues};
pub use preflight::preflight_gitlab;
pub use prs::list_mrs;
pub use search::search_mrs;

use crate::backend::BackendError;

/// Resolve the GraphQL endpoint URL for a `.com` or self-hosted
/// GitLab. gitlab.com uses `https://gitlab.com/api/graphql`;
/// self-hosted appends `/api/graphql` to the user-supplied hostname.
pub(super) fn graphql_endpoint(hostname: Option<&str>) -> Result<String, BackendError> {
    match hostname {
        None => Ok("https://gitlab.com/api/graphql".to_string()),
        Some(h) => {
            let trimmed = h.trim_end_matches('/');
            if trimmed.is_empty() {
                return Err(BackendError::NetworkError {
                    detail: "empty hostname for self-hosted GitLab".to_string(),
                });
            }
            Ok(format!("{trimmed}/api/graphql"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graphql_endpoint_dot_com() {
        assert_eq!(
            graphql_endpoint(None).unwrap(),
            "https://gitlab.com/api/graphql"
        );
    }

    #[test]
    fn graphql_endpoint_self_hosted_appends_path() {
        assert_eq!(
            graphql_endpoint(Some("https://gitlab.example.com")).unwrap(),
            "https://gitlab.example.com/api/graphql"
        );
    }

    #[test]
    fn graphql_endpoint_strips_trailing_slash() {
        assert_eq!(
            graphql_endpoint(Some("https://gitlab.example.com/")).unwrap(),
            "https://gitlab.example.com/api/graphql"
        );
    }

    #[test]
    fn graphql_endpoint_rejects_empty_hostname() {
        assert!(matches!(
            graphql_endpoint(Some("/")),
            Err(BackendError::NetworkError { .. })
        ));
    }
}
