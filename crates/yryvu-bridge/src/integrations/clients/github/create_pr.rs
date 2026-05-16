// SPDX-License-Identifier: AGPL-3.0-or-later

//! Create a new pull request on `owner/repo`. The POST endpoint
//! takes title/body/head/base/draft inline; labels/assignees/milestone
//! land via a follow-up `PATCH /issues/{n}` (GitHub treats PRs as
//! issues for these fields), and reviewers via
//! `POST /pulls/{n}/requested_reviewers`. All follow-ups are
//! best-effort: PR creation succeeds even if metadata application
//! fails (the user gets a partial result rather than an aborted PR).

use reqwest::Method;
use serde::Serialize;

use crate::backend::BackendError;

use super::super::http::{self, GITHUB_QUIRKS};
use super::super::types::CreatePrInput;
use super::api_base;
use super::detail::{project_detail, PullRequestDetail};
use super::detail_raw::GhPullDetail;

pub async fn create_pr(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    input: &CreatePrInput,
) -> Result<PullRequestDetail, BackendError> {
    let base = api_base(hostname)?;
    let url = format!("{base}/repos/{owner}/{repo}/pulls");
    let body = GhCreatePrBody {
        title: &input.title,
        body: &input.body,
        head: &input.head_ref,
        base: &input.base_ref,
        draft: input.draft,
    };
    let client = http::client()?;
    let req = http::authed(
        &client,
        Method::POST,
        &url,
        token,
        "application/vnd.github.v3+json",
    )
    .json(&body);
    let resp = http::execute(req, GITHUB_QUIRKS).await?;
    let raw: GhPullDetail = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding POST /pulls response", e))?;
    let pr = project_detail(raw);

    // Best-effort metadata application — failures don't block the
    // success path. The PR exists; the user can wire labels/etc by
    // hand if GitHub rejects the follow-up (e.g. permission gap).
    let milestone = input
        .milestone
        .as_deref()
        .and_then(|s| s.parse::<u64>().ok());
    let has_issue_patch =
        !input.labels.is_empty() || !input.assignees.is_empty() || milestone.is_some();
    if has_issue_patch {
        let patch_url = format!("{base}/repos/{owner}/{repo}/issues/{}", pr.number);
        let patch_body = GhIssuePatchBody {
            labels: &input.labels,
            assignees: &input.assignees,
            milestone,
        };
        let _ = http::execute(
            http::authed(
                &client,
                Method::PATCH,
                &patch_url,
                token,
                "application/vnd.github.v3+json",
            )
            .json(&patch_body),
            GITHUB_QUIRKS,
        )
        .await;
    }
    if !input.reviewers.is_empty() {
        let rev_url = format!(
            "{base}/repos/{owner}/{repo}/pulls/{}/requested_reviewers",
            pr.number
        );
        let rev_body = GhReviewersBody {
            reviewers: &input.reviewers,
        };
        let _ = http::execute(
            http::authed(
                &client,
                Method::POST,
                &rev_url,
                token,
                "application/vnd.github.v3+json",
            )
            .json(&rev_body),
            GITHUB_QUIRKS,
        )
        .await;
    }
    Ok(pr)
}

#[derive(Debug, Serialize)]
struct GhCreatePrBody<'a> {
    title: &'a str,
    #[serde(skip_serializing_if = "str::is_empty")]
    body: &'a str,
    head: &'a str,
    base: &'a str,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    draft: bool,
}

#[derive(Debug, Serialize)]
struct GhIssuePatchBody<'a> {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    labels: &'a Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    assignees: &'a Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    milestone: Option<u64>,
}

#[derive(Debug, Serialize)]
struct GhReviewersBody<'a> {
    reviewers: &'a Vec<String>,
}
