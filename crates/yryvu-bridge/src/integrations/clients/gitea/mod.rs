// SPDX-License-Identifier: AGPL-3.0-or-later

//! Gitea / Forgejo API client. Forgejo is a Gitea fork with a
//! compatible REST API, so a single client covers both. Mirrors the
//! GitHub / GitLab module layouts ([`super::github`], [`super::gitlab`])
//! — each submodule owns one API surface and stays under the 400 LOC
//! cap for production code:
//!
//! - [`preflight`] — `GET /api/v1/user` for token validation.
//! - [`prs`] — pull-request listing (REST `/api/v1/repos/{owner}/{repo}/pulls`).
//! - [`dsl`] — yryvu DSL → Gitea filter query params.
//! - [`search`] — filtered PR search via the same REST endpoint with
//!   query params applied.
//!
//! Gitea has no native GraphQL endpoint, so review-aggregate +
//! CI-rollup status would require N+1 REST calls. Wave 1 surfaces
//! those badges as `null` rather than pay the round-trip tax;
//! revisit when users push back.

mod comments;
mod dsl;
mod issues;
mod preflight;
mod prs;
mod repo_metadata;
mod search;

pub use comments::{create_comment, list_comments};
pub use issues::{create_issue, get_issue_detail, list_issues};
pub use preflight::preflight_gitea;
pub use prs::list_prs;
pub use repo_metadata::{list_collaborators, list_labels, list_milestones};
pub use search::search_prs;

use crate::backend::BackendError;

/// Resolve the REST base URL for a default-instance or self-hosted
/// Gitea / Forgejo. `gitea` default points at codeberg.org (the most
/// visible public Gitea deployment); `giteaSelfHosted` appends
/// `/api/v1` to the user-supplied hostname.
///
/// Gitea instances vary: some run at root, some under a sub-path. We
/// only support root deployment for now — sub-path support can wait
/// for a real user request.
pub(super) fn api_base(hostname: Option<&str>) -> Result<String, BackendError> {
    match hostname {
        None => Ok("https://codeberg.org/api/v1".to_string()),
        Some(h) => {
            let trimmed = h.trim_end_matches('/');
            if trimmed.is_empty() {
                return Err(BackendError::NetworkError {
                    detail: "empty hostname for self-hosted Gitea / Forgejo".to_string(),
                });
            }
            Ok(format!("{trimmed}/api/v1"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_base_default_is_codeberg() {
        assert_eq!(api_base(None).unwrap(), "https://codeberg.org/api/v1");
    }

    #[test]
    fn api_base_self_hosted_appends_v1() {
        assert_eq!(
            api_base(Some("https://gitea.example.com")).unwrap(),
            "https://gitea.example.com/api/v1"
        );
    }

    #[test]
    fn api_base_strips_trailing_slash() {
        assert_eq!(
            api_base(Some("https://gitea.example.com/")).unwrap(),
            "https://gitea.example.com/api/v1"
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
