// SPDX-License-Identifier: AGPL-3.0-or-later

//! Create a new PR on `owner/repo`. `POST /repos/{o}/{r}/pulls` —
//! Gitea / Forgejo returns the freshly-created PR in the same shape
//! as the single-PR GET, so the projector from `detail.rs` is reused.
//!
//! Reviewers don't ship with the create payload; users on Gitea
//! request reviewers via a separate `POST /pulls/{n}/requested_reviewers`
//! call which we apply best-effort after the create succeeds.

use reqwest::Method;
use serde::Serialize;

use crate::backend::BackendError;

use super::super::github::PullRequestDetail;
use super::super::http::{self, GITEA_QUIRKS};
use super::super::types::CreatePrInput;
use super::api_base;
use super::detail::{project_pr, GiteaPullDetail};
use super::issues::parse_ids;

pub async fn create_pr(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    input: &CreatePrInput,
) -> Result<PullRequestDetail, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/pulls");
    let body = GiteaCreatePrBody {
        title: &input.title,
        body: &input.body,
        head: &input.head_ref,
        base: &input.base_ref,
        labels: parse_ids(&input.labels),
        assignees: &input.assignees,
        milestone: input
            .milestone
            .as_deref()
            .and_then(|s| s.parse::<u64>().ok()),
    };
    let client = http::client()?;
    let req = http::authed(&client, Method::POST, &url, token, "application/json").json(&body);
    let resp = http::execute(req, GITEA_QUIRKS).await?;
    let raw: GiteaPullDetail = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding POST /pulls response", e))?;
    let pr = project_pr(raw);

    // Best-effort reviewer request — same pattern as the GitHub
    // adapter. Gitea expects `{ reviewers: [username] }`; failures
    // don't block the success path because the PR already exists.
    if !input.reviewers.is_empty() {
        let rev_url = format!(
            "{base}/repos/{owner}/{repo}/pulls/{}/requested_reviewers",
            pr.number
        );
        let rev_body = GiteaReviewersBody {
            reviewers: &input.reviewers,
        };
        let _ = http::execute(
            http::authed(&client, Method::POST, &rev_url, token, "application/json")
                .json(&rev_body),
            GITEA_QUIRKS,
        )
        .await;
    }
    Ok(pr)
}

#[derive(Debug, Serialize)]
struct GiteaCreatePrBody<'a> {
    title: &'a str,
    #[serde(skip_serializing_if = "str::is_empty")]
    body: &'a str,
    head: &'a str,
    base: &'a str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    labels: Vec<u64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    assignees: &'a Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    milestone: Option<u64>,
}

#[derive(Debug, Serialize)]
struct GiteaReviewersBody<'a> {
    reviewers: &'a Vec<String>,
}
