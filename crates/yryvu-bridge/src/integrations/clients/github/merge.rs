// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitHub PR mutation endpoints — the state-flips driven by the
//! action-button cluster (#91) and the merge form (#92).
//!
//! Groups every PATCH / PUT / DELETE that targets a single PR so
//! `detail.rs` keeps its focus on the read-side surface (detail /
//! commits / files / checks).

use reqwest::Method;
use serde::Serialize;

use crate::backend::BackendError;

use super::super::http::{self, GITHUB_PATCH_QUIRKS};
use super::api_base;
use super::detail::{project_detail, PullRequestDetail};
use super::detail_raw::GhPullDetail;

/// Read-side action verb (close / reopen / draft toggling) routed by
/// [`pr_action`] to `PATCH /pulls/{number}`. Each variant emits the
/// minimal body that GitHub expects.
#[derive(Debug, Clone, Copy)]
pub enum PrAction {
    Close,
    Reopen,
    ConvertToDraft,
    MarkReadyForReview,
}

impl PrAction {
    fn body(self) -> serde_json::Value {
        match self {
            Self::Close => serde_json::json!({ "state": "closed" }),
            Self::Reopen => serde_json::json!({ "state": "open" }),
            Self::ConvertToDraft => serde_json::json!({ "draft": true }),
            Self::MarkReadyForReview => serde_json::json!({ "draft": false }),
        }
    }
}

/// Strategy GitHub applies when merging the PR. The trio mirrors
/// `mergeMethod` in the REST API spec; values serialize lowercase.
#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MergeMethod {
    #[default]
    Merge,
    Squash,
    Rebase,
}

/// Parameters for [`merge_pr`]. Title / message are optional — when
/// `None`, GitHub falls back to the PR's title and description.
#[derive(Debug, Clone, Default)]
pub struct MergeRequest {
    pub method: MergeMethod,
    pub commit_title: Option<String>,
    pub commit_message: Option<String>,
}

impl MergeRequest {
    fn body(&self) -> serde_json::Value {
        let mut obj = serde_json::Map::new();
        obj.insert(
            "merge_method".to_string(),
            serde_json::to_value(self.method).unwrap_or_else(|_| "merge".into()),
        );
        if let Some(t) = &self.commit_title {
            obj.insert("commit_title".to_string(), t.clone().into());
        }
        if let Some(m) = &self.commit_message {
            obj.insert("commit_message".to_string(), m.clone().into());
        }
        serde_json::Value::Object(obj)
    }
}

/// Apply a read-side state flip (close / reopen / draft toggling) via
/// `PATCH /pulls/{number}`. Returns the refreshed detail so the
/// caller refreshes the panel in a single round-trip.
pub async fn pr_action(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    number: u64,
    action: PrAction,
) -> Result<PullRequestDetail, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/pulls/{number}");
    let client = http::client()?;
    let req = http::authed(
        &client,
        Method::PATCH,
        &url,
        token,
        "application/vnd.github.v3+json",
    )
    .json(&action.body());
    let resp = http::execute(req, GITHUB_PATCH_QUIRKS).await?;
    let raw: GhPullDetail = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding PATCH /pulls response", e))?;
    Ok(project_detail(raw))
}

/// Merge a PR via `PUT /pulls/{number}/merge`. GitHub returns a
/// merge-info envelope (`merged`, `sha`, `message`) rather than the
/// full PR shape; we re-fetch via [`super::detail::get_pr_detail`]
/// after the merge to refresh the panel.
pub async fn merge_pr(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    number: u64,
    request: MergeRequest,
) -> Result<PullRequestDetail, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/pulls/{number}/merge");
    let client = http::client()?;
    let req = http::authed(
        &client,
        Method::PUT,
        &url,
        token,
        "application/vnd.github.v3+json",
    )
    .json(&request.body());
    // Same write-side quirks (403 → "needs repo write") apply here.
    let _ = http::execute(req, GITHUB_PATCH_QUIRKS).await?;
    super::detail::get_pr_detail(token, hostname, owner, repo, number).await
}

/// Delete a branch via `DELETE /git/refs/heads/{branch}`. Called
/// after a successful merge when the user opted into "delete source
/// branch". 422 (branch already gone, e.g. someone else cleaned up
/// first) is downgraded to success since the desired end-state is met.
pub async fn delete_branch(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    branch: &str,
) -> Result<(), BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/git/refs/heads/{branch}");
    let client = http::client()?;
    let req = http::authed(
        &client,
        Method::DELETE,
        &url,
        token,
        "application/vnd.github.v3+json",
    );
    let resp = req.send().await.map_err(http::network_error)?;
    let status = resp.status();
    if status.is_success() || status == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
        return Ok(());
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(BackendError::InvalidToken);
    }
    if status == reqwest::StatusCode::FORBIDDEN {
        return Err(BackendError::InsufficientScopes {
            granted: "read-only".to_string(),
            required: "repo (write)".to_string(),
        });
    }
    Err(BackendError::NetworkError {
        detail: format!("unexpected HTTP {status} from DELETE /git/refs/heads/{branch}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pr_action_body_close() {
        assert_eq!(PrAction::Close.body()["state"], "closed");
    }

    #[test]
    fn pr_action_body_reopen() {
        assert_eq!(PrAction::Reopen.body()["state"], "open");
    }

    #[test]
    fn pr_action_body_convert_draft() {
        assert_eq!(PrAction::ConvertToDraft.body()["draft"], true);
    }

    #[test]
    fn pr_action_body_mark_ready() {
        assert_eq!(PrAction::MarkReadyForReview.body()["draft"], false);
    }

    #[test]
    fn merge_method_serialises_lowercase() {
        for (variant, expected) in [
            (MergeMethod::Merge, "\"merge\""),
            (MergeMethod::Squash, "\"squash\""),
            (MergeMethod::Rebase, "\"rebase\""),
        ] {
            assert_eq!(serde_json::to_string(&variant).unwrap(), expected);
        }
    }

    #[test]
    fn merge_request_body_minimal() {
        let req = MergeRequest {
            method: MergeMethod::Squash,
            ..MergeRequest::default()
        };
        let body = req.body();
        assert_eq!(body["merge_method"], "squash");
        assert!(body.get("commit_title").is_none());
        assert!(body.get("commit_message").is_none());
    }

    #[test]
    fn merge_request_body_full() {
        let req = MergeRequest {
            method: MergeMethod::Rebase,
            commit_title: Some("Squashed title".to_string()),
            commit_message: Some("Lengthy body".to_string()),
        };
        let body = req.body();
        assert_eq!(body["merge_method"], "rebase");
        assert_eq!(body["commit_title"], "Squashed title");
        assert_eq!(body["commit_message"], "Lengthy body");
    }
}
