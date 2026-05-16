// SPDX-License-Identifier: AGPL-3.0-or-later

//! Create a new merge request via REST `POST /projects/{ns}/merge_requests`.
//! GitLab's REST POST returns a slim payload; we follow with a
//! `get_mr_detail` call to materialise the canonical
//! [`PullRequestDetail`] shape (same one the detail panel renders).
//! Draft state is conveyed via the `Draft: ` title prefix because
//! GitLab's REST `draft` parameter is REST-API-version-dependent.

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::super::github::PullRequestDetail;
use super::super::http::{self, GITLAB_QUIRKS};
use super::super::types::CreatePrInput;
use super::detail::get_mr_detail;

pub async fn create_pr(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    input: &CreatePrInput,
) -> Result<PullRequestDetail, BackendError> {
    let base = rest_base(hostname)?;
    let project = format!("{owner}%2F{repo}");
    let url = format!("{base}/projects/{project}/merge_requests");
    let title = decorate_draft(&input.title, input.draft);
    let body = GlCreateMrBody {
        title: &title,
        description: &input.body,
        source_branch: &input.head_ref,
        target_branch: &input.base_ref,
        label_ids: super::issues::parse_ids(&input.labels),
        assignee_ids: super::issues::parse_ids(&input.assignees),
        reviewer_ids: super::issues::parse_ids(&input.reviewers),
        milestone_id: input
            .milestone
            .as_deref()
            .and_then(|s| s.parse::<u64>().ok()),
    };
    let client = http::client()?;
    let req = http::authed(&client, Method::POST, &url, token, "application/json").json(&body);
    let resp = http::execute(req, GITLAB_QUIRKS).await?;
    let created: GlCreateMrResp = resp
        .json()
        .await
        .map_err(|e| http::decode_error("decoding POST /merge_requests response", e))?;
    get_mr_detail(token, hostname, owner, repo, created.iid).await
}

fn rest_base(hostname: Option<&str>) -> Result<String, BackendError> {
    match hostname {
        None => Ok("https://gitlab.com/api/v4".to_string()),
        Some(h) => {
            let trimmed = h.trim_end_matches('/');
            if trimmed.is_empty() {
                return Err(BackendError::NetworkError {
                    detail: "empty hostname for self-hosted GitLab".to_string(),
                });
            }
            Ok(format!("{trimmed}/api/v4"))
        }
    }
}

fn decorate_draft(title: &str, draft: bool) -> String {
    if !draft {
        return title.to_string();
    }
    let already_prefixed = title.starts_with("Draft:")
        || title.starts_with("[Draft]")
        || title.starts_with("WIP:")
        || title.starts_with("[WIP]");
    if already_prefixed {
        title.to_string()
    } else {
        format!("Draft: {title}")
    }
}

#[derive(Debug, Serialize)]
struct GlCreateMrBody<'a> {
    title: &'a str,
    #[serde(skip_serializing_if = "str::is_empty")]
    description: &'a str,
    source_branch: &'a str,
    target_branch: &'a str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    label_ids: Vec<u64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    assignee_ids: Vec<u64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    reviewer_ids: Vec<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    milestone_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GlCreateMrResp {
    iid: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draft_prefix_added_when_not_present() {
        assert_eq!(decorate_draft("Fix bug", true), "Draft: Fix bug");
    }

    #[test]
    fn draft_prefix_not_double_applied() {
        assert_eq!(decorate_draft("Draft: Fix bug", true), "Draft: Fix bug");
        assert_eq!(decorate_draft("[WIP] Fix bug", true), "[WIP] Fix bug");
    }

    #[test]
    fn no_prefix_when_draft_false() {
        assert_eq!(decorate_draft("Fix bug", false), "Fix bug");
    }
}
