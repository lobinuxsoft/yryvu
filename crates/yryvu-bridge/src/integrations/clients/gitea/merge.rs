// SPDX-License-Identifier: AGPL-3.0-or-later

//! Gitea / Forgejo PR write-side mutations. `merge_pr` hits
//! `POST /pulls/{n}/merge`; `pr_action` flips state via
//! `PATCH /issues/{n}` (Gitea routes PR state through the issue
//! endpoint since PRs are issues server-side).
//!
//! Reuses the canonical [`MergeMethod`] / [`MergeRequest`] /
//! [`PrAction`] types from the GitHub client so the frontend's
//! merge-form contract stays uniform across providers.

use reqwest::Method;
use serde::Serialize;

use crate::backend::BackendError;

use super::super::github::{MergeMethod, MergeRequest, PrAction, PullRequestDetail};
use super::super::http::{self, GITEA_QUIRKS};
use super::api_base;

/// Apply a state flip (close / reopen) via `PATCH /issues/{n}`.
/// Returns the refreshed PR detail. Draft toggling isn't supported
/// in v1 — Gitea's API encodes draft via a `[WIP]` title prefix
/// rather than a flag, which would require regex munging client-side.
pub async fn pr_action(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    number: u64,
    action: PrAction,
) -> Result<PullRequestDetail, BackendError> {
    let body = match action {
        PrAction::Close => serde_json::json!({ "state": "closed" }),
        PrAction::Reopen => serde_json::json!({ "state": "open" }),
        PrAction::ConvertToDraft | PrAction::MarkReadyForReview => {
            return Err(BackendError::NotImplemented(
                "draft toggling not supported on Gitea / Forgejo (server-side draft is title-prefix based)",
            ));
        }
    };
    let url = format!(
        "{}/repos/{owner}/{repo}/issues/{number}",
        api_base(hostname)?
    );
    let client = http::client()?;
    let req = http::authed(&client, Method::PATCH, &url, token, "application/json").json(&body);
    let _ = http::execute(req, GITEA_QUIRKS).await?;
    super::detail::get_pr_detail(token, hostname, owner, repo, number).await
}

/// Merge a PR via `POST /pulls/{n}/merge`. Gitea returns 200 with an
/// empty body on success; we re-fetch the detail to refresh the
/// panel in a single round-trip.
pub async fn merge_pr(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    number: u64,
    request: MergeRequest,
) -> Result<PullRequestDetail, BackendError> {
    let url = format!(
        "{}/repos/{owner}/{repo}/pulls/{number}/merge",
        api_base(hostname)?
    );
    let body = GiteaMergeBody {
        do_: gitea_method(request.method),
        merge_title_field: request.commit_title.as_deref(),
        merge_message_field: request.commit_message.as_deref(),
    };
    let client = http::client()?;
    let req = http::authed(&client, Method::POST, &url, token, "application/json").json(&body);
    let _ = http::execute(req, GITEA_QUIRKS).await?;
    super::detail::get_pr_detail(token, hostname, owner, repo, number).await
}

/// Map the canonical [`MergeMethod`] to Gitea's `Do` enum string.
/// Gitea accepts `merge`, `rebase`, `rebase-merge` and `squash`; the
/// 3-way canonical enum maps cleanly onto the first three options.
fn gitea_method(method: MergeMethod) -> &'static str {
    match method {
        MergeMethod::Merge => "merge",
        MergeMethod::Squash => "squash",
        MergeMethod::Rebase => "rebase",
    }
}

#[derive(Debug, Serialize)]
struct GiteaMergeBody<'a> {
    /// Gitea requires the field to be literally named `Do` (uppercase
    /// D, no underscore). `do` is a Rust keyword so we rename via
    /// serde.
    #[serde(rename = "Do")]
    do_: &'static str,
    #[serde(skip_serializing_if = "Option::is_none", rename = "MergeTitleField")]
    merge_title_field: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "MergeMessageField")]
    merge_message_field: Option<&'a str>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_method_maps_to_gitea_strings() {
        assert_eq!(gitea_method(MergeMethod::Merge), "merge");
        assert_eq!(gitea_method(MergeMethod::Squash), "squash");
        assert_eq!(gitea_method(MergeMethod::Rebase), "rebase");
    }

    #[test]
    fn merge_body_serialises_with_capitalised_keys() {
        let body = GiteaMergeBody {
            do_: "squash",
            merge_title_field: Some("title"),
            merge_message_field: Some("msg"),
        };
        let s = serde_json::to_string(&body).unwrap();
        assert!(s.contains("\"Do\":\"squash\""));
        assert!(s.contains("\"MergeTitleField\":\"title\""));
        assert!(s.contains("\"MergeMessageField\":\"msg\""));
    }

    #[test]
    fn merge_body_minimal_skips_optional_fields() {
        let body = GiteaMergeBody {
            do_: "merge",
            merge_title_field: None,
            merge_message_field: None,
        };
        let s = serde_json::to_string(&body).unwrap();
        assert_eq!(s, "{\"Do\":\"merge\"}");
    }
}
