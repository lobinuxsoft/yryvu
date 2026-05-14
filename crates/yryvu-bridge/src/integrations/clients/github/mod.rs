// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub API client. Submodules own one API surface each:
//!
//! - [`preflight`] — `GET /user` token validation + scope check.
//! - [`prs`] — pull request listing (REST `GET /repos/{owner}/{repo}/pulls`).
//!
//! Each submodule stays under the 400 LOC cap. Cross-cutting HTTP
//! plumbing (client builder, status-code mapping, auth headers) lives
//! in [`super::http`]; this module only owns the GitHub-specific base
//! URL helper.

mod detail;
mod detail_raw;
mod dsl;
mod graphql;
mod merge;
mod preflight;
mod prs;
mod search;

pub use detail::{
    get_pr_detail, list_pr_checks, list_pr_commits, list_pr_files, CheckRun, PrCommit, PrFile,
    PullRequestDetail,
};
pub use graphql::enrich_prs;
pub use merge::{delete_branch, merge_pr, pr_action, MergeMethod, MergeRequest, PrAction};
pub use preflight::preflight_github;
pub use prs::{list_prs, CiStatus, PullRequestState, PullRequestSummary, ReviewDecision};
pub use search::search_prs;

use crate::backend::BackendError;

/// Resolve the API base URL for a `.com` or self-hosted endpoint.
/// yryvu strips trailing slashes from user-supplied hostnames before
/// concatenating to avoid `//api/v3/user`.
pub(super) fn api_base(hostname: Option<&str>) -> Result<String, BackendError> {
    match hostname {
        None => Ok("https://api.github.com".to_string()),
        Some(h) => {
            let trimmed = h.trim_end_matches('/');
            if trimmed.is_empty() {
                return Err(BackendError::NetworkError {
                    detail: "empty hostname for GH Enterprise".to_string(),
                });
            }
            Ok(format!("{trimmed}/api/v3"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_base_dot_com() {
        assert_eq!(api_base(None).unwrap(), "https://api.github.com");
    }

    #[test]
    fn api_base_ghe_appends_v3() {
        assert_eq!(
            api_base(Some("https://ghe.example.com")).unwrap(),
            "https://ghe.example.com/api/v3"
        );
    }

    #[test]
    fn api_base_strips_trailing_slash() {
        assert_eq!(
            api_base(Some("https://ghe.example.com/")).unwrap(),
            "https://ghe.example.com/api/v3"
        );
    }

    #[test]
    fn api_base_rejects_empty_hostname() {
        assert!(matches!(
            api_base(Some("/")),
            Err(BackendError::NetworkError { .. })
        ));
    }
}
