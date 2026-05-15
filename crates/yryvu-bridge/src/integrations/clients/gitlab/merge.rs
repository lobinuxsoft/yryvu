// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitLab MR write-side mutations powering the merge form (#94):
//!
//! - [`merge_mr`] hits `PUT /projects/:project/merge_requests/:iid/merge`,
//!   honouring the canonical [`MergeMethod`] / [`MergeRequest`] /
//!   `delete_source_branch` flag.
//! - [`rebase_mr`] hits `PUT /projects/:project/merge_requests/:iid/rebase`
//!   with the optional `?skip_ci=true` query string. GitLab returns
//!   `202 Accepted` immediately and rebases asynchronously; we re-fetch
//!   the detail so the caller sees the freshest mergeable state in one
//!   round-trip without polling.
//!
//! GitLab's merge model has two GitHub-incompatible wrinkles:
//!
//! 1. The `merge_method` (merge / rebase_merge / fast-forward) is a
//!    project-level setting, not a per-merge enum. The radio choice on
//!    the form is informational; what actually happens server-side is
//!    dictated by the project's policy. Frontend gates the radios via
//!    [`super::super::types::ProjectMergeMethod`] so the user only
//!    sees options the project allows.
//! 2. `squash` is an independent boolean, separate from the merge
//!    method. The frontend offers an explicit checkbox; the
//!    [`MergeMethod::Squash`] radio acts as a shortcut that pre-checks it.

use reqwest::Method;
use serde_json::Value;

use crate::backend::BackendError;

use super::super::github::{MergeMethod, MergeRequest, PullRequestDetail};
use super::super::http::{self, GITLAB_QUIRKS};
use super::detail::{get_mr_detail, project_path, rest_base};

/// Merge an MR via `PUT /projects/:project/merge_requests/:iid/merge`.
/// The body honours `should_remove_source_branch`, `squash` (independent
/// of method, derived from the radio + checkbox), and the merge /
/// squash commit message slot picked by the squash flag.
pub async fn merge_mr(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    iid: u64,
    request: MergeRequest,
    delete_source_branch: bool,
) -> Result<PullRequestDetail, BackendError> {
    let url = format!(
        "{}/projects/{}/merge_requests/{iid}/merge",
        rest_base(hostname)?,
        project_path(owner, repo)
    );
    let body = build_merge_body(&request, delete_source_branch);
    let client = http::client()?;
    let req = http::authed(&client, Method::PUT, &url, token, "application/json").json(&body);
    let _ = http::execute(req, GITLAB_QUIRKS).await?;
    get_mr_detail(token, hostname, owner, repo, iid).await
}

/// Rebase the MR's source branch onto target via
/// `PUT /projects/:project/merge_requests/:iid/rebase`. `skip_ci`
/// suppresses the pipeline trigger that would normally fire on the
/// rebased commits — useful for trivial rebases where running CI again
/// would be wasted time.
///
/// GitLab returns `202 Accepted` and rebases asynchronously. We don't
/// poll for completion; the panel re-fetches detail on its own cadence
/// and surfaces `rebase_in_progress` via the `mergeStatus` field.
pub async fn rebase_mr(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    iid: u64,
    skip_ci: bool,
) -> Result<PullRequestDetail, BackendError> {
    let mut url = format!(
        "{}/projects/{}/merge_requests/{iid}/rebase",
        rest_base(hostname)?,
        project_path(owner, repo)
    );
    if skip_ci {
        url.push_str("?skip_ci=true");
    }
    let client = http::client()?;
    let req = http::authed(&client, Method::PUT, &url, token, "application/json");
    let _ = http::execute(req, GITLAB_QUIRKS).await?;
    get_mr_detail(token, hostname, owner, repo, iid).await
}

/// Build the JSON body for `PUT /merge`. Public to the module for
/// tests + transparency; production callsites only see [`merge_mr`].
pub(super) fn build_merge_body(request: &MergeRequest, delete_source_branch: bool) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert(
        "should_remove_source_branch".into(),
        delete_source_branch.into(),
    );
    let squash = compute_squash(request);
    obj.insert("squash".into(), squash.into());
    if let Some(message) = combine_message(&request.commit_title, &request.commit_message) {
        // GitLab routes the commit body to a different field depending
        // on whether this merge will squash or not — the field that
        // doesn't apply is silently ignored, but sending the right one
        // keeps the request small and the audit log clear.
        let key = if squash {
            "squash_commit_message"
        } else {
            "merge_commit_message"
        };
        obj.insert(key.into(), message.into());
    }
    Value::Object(obj)
}

/// Resolve the squash flag from the canonical [`MergeRequest`].
/// `MergeMethod::Squash` always squashes (radio shortcut). For the
/// other methods, the explicit `request.squash` checkbox wins; absent
/// (None) defaults to false so the merge stays predictable.
pub(super) fn compute_squash(request: &MergeRequest) -> bool {
    matches!(request.method, MergeMethod::Squash) || request.squash.unwrap_or(false)
}

/// Stitch the form's `commit_title` + `commit_message` into a single
/// commit body the way GitLab expects (title is the first line, body
/// is the rest, separated by a blank line). Empty inputs collapse so
/// GitLab falls back to its own default (the MR title / first commit).
pub(super) fn combine_message(title: &Option<String>, message: &Option<String>) -> Option<String> {
    let title = title.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let message = message.as_deref().map(str::trim).filter(|s| !s.is_empty());
    match (title, message) {
        (Some(t), Some(m)) => Some(format!("{t}\n\n{m}")),
        (Some(t), None) => Some(t.to_string()),
        (None, Some(m)) => Some(m.to_string()),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn req(method: MergeMethod, squash: Option<bool>) -> MergeRequest {
        MergeRequest {
            method,
            commit_title: None,
            commit_message: None,
            squash,
        }
    }

    #[test]
    fn squash_method_forces_squash_flag() {
        assert!(compute_squash(&req(MergeMethod::Squash, None)));
        assert!(compute_squash(&req(MergeMethod::Squash, Some(false))));
    }

    #[test]
    fn non_squash_method_honours_checkbox() {
        assert!(!compute_squash(&req(MergeMethod::Merge, None)));
        assert!(!compute_squash(&req(MergeMethod::Merge, Some(false))));
        assert!(compute_squash(&req(MergeMethod::Merge, Some(true))));
        assert!(compute_squash(&req(MergeMethod::Rebase, Some(true))));
    }

    #[test]
    fn body_minimal_carries_squash_and_delete_branch() {
        let body = build_merge_body(&req(MergeMethod::Merge, None), true);
        assert_eq!(body["should_remove_source_branch"], true);
        assert_eq!(body["squash"], false);
        assert!(body.get("merge_commit_message").is_none());
        assert!(body.get("squash_commit_message").is_none());
    }

    #[test]
    fn body_squash_routes_message_to_squash_field() {
        let request = MergeRequest {
            method: MergeMethod::Squash,
            commit_title: Some("Squashed title".into()),
            commit_message: Some("body".into()),
            squash: None,
        };
        let body = build_merge_body(&request, false);
        assert_eq!(body["squash"], true);
        assert_eq!(body["should_remove_source_branch"], false);
        assert_eq!(body["squash_commit_message"], "Squashed title\n\nbody");
        assert!(body.get("merge_commit_message").is_none());
    }

    #[test]
    fn body_merge_method_with_message_uses_merge_commit_field() {
        let request = MergeRequest {
            method: MergeMethod::Merge,
            commit_title: Some("Merge title".into()),
            commit_message: None,
            squash: Some(false),
        };
        let body = build_merge_body(&request, true);
        assert_eq!(body["squash"], false);
        assert_eq!(body["merge_commit_message"], "Merge title");
    }

    #[test]
    fn body_merge_with_squash_checkbox_routes_to_squash_field() {
        let request = MergeRequest {
            method: MergeMethod::Merge,
            commit_title: Some("Custom".into()),
            commit_message: Some("body".into()),
            squash: Some(true),
        };
        let body = build_merge_body(&request, false);
        assert_eq!(body["squash"], true);
        assert_eq!(body["squash_commit_message"], "Custom\n\nbody");
    }

    #[test]
    fn combine_message_handles_empty_and_missing() {
        assert_eq!(combine_message(&None, &None), None);
        assert_eq!(combine_message(&Some(String::new()), &None), None);
        assert_eq!(
            combine_message(&Some("  ".into()), &Some("\n".into())),
            None
        );
        assert_eq!(
            combine_message(&Some("t".into()), &Some("m".into())),
            Some("t\n\nm".into())
        );
        assert_eq!(
            combine_message(&None, &Some("only msg".into())),
            Some("only msg".into())
        );
    }

    /// `json!` regression — confirms the body shape stays the same so
    /// future schema-aware tooling sees no drift.
    #[test]
    fn body_serialises_as_expected_object() {
        let request = req(MergeMethod::Merge, Some(false));
        let body = build_merge_body(&request, false);
        assert_eq!(
            body,
            json!({ "should_remove_source_branch": false, "squash": false })
        );
    }
}
