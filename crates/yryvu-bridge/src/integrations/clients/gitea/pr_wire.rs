// SPDX-License-Identifier: AGPL-3.0-or-later

//! Gitea / Forgejo PR wire types (REST v1 DTOs) + their projections onto
//! the cross-provider [`PullRequestDetail`] / [`PrCommit`] / [`PrFile`] /
//! [`CheckRun`] shapes. Shared by `detail.rs` (read endpoints) and
//! `create_pr.rs` (which projects the freshly-created PR), so the DTOs +
//! projectors live here rather than in either consumer.

use serde::Deserialize;

use super::super::github::{CheckRun, PrCommit, PrFile, PullRequestDetail, PullRequestState};
use super::super::types::{Label, UserInfo};

#[derive(Debug, Deserialize)]
pub(super) struct GiteaPullDetail {
    number: u64,
    title: Option<String>,
    state: Option<String>,
    #[serde(default)]
    draft: bool,
    user: Option<GiteaPullUser>,
    body: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    closed_at: Option<String>,
    merged_at: Option<String>,
    html_url: Option<String>,
    head: Option<GiteaRef>,
    base: Option<GiteaRef>,
    mergeable: Option<bool>,
    additions: Option<u64>,
    deletions: Option<u64>,
    changed_files: Option<u64>,
    comments: Option<u64>,
    #[serde(default)]
    labels: Vec<GiteaLabel>,
    #[serde(default)]
    assignees: Vec<GiteaPullUser>,
    #[serde(default)]
    requested_reviewers: Vec<GiteaPullUser>,
    milestone: Option<GiteaMilestoneMini>,
}

#[derive(Debug, Deserialize, Default, Clone)]
struct GiteaPullUser {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GiteaRef {
    #[serde(rename = "ref")]
    ref_name: String,
    sha: String,
}

#[derive(Debug, Deserialize)]
struct GiteaLabel {
    name: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct GiteaMilestoneMini {
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GiteaCommit {
    sha: String,
    commit: GiteaCommitInner,
    author: Option<GiteaPullUser>,
}

#[derive(Debug, Deserialize)]
struct GiteaCommitInner {
    message: Option<String>,
    author: Option<GiteaCommitAuthor>,
}

#[derive(Debug, Deserialize, Default)]
struct GiteaCommitAuthor {
    name: Option<String>,
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GiteaFile {
    filename: String,
    status: Option<String>,
    additions: Option<u64>,
    deletions: Option<u64>,
    /// Gitea names the diff field `patch` (same as GitHub).
    patch: Option<String>,
    previous_filename: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GiteaStatus {
    context: String,
    /// `success` / `failure` / `pending` / `warning` / `error`.
    status: String,
    target_url: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

/// Common helper for the assignee / reviewer projections — login is
/// re-used as the display name when Gitea doesn't return a full name.
fn project_user(u: GiteaPullUser) -> UserInfo {
    UserInfo {
        display_name: u.login.clone(),
        login: u.login,
        avatar_url: u.avatar_url.unwrap_or_default(),
    }
}

pub(super) fn project_pr(raw: GiteaPullDetail) -> PullRequestDetail {
    let state = if raw.merged_at.is_some() {
        PullRequestState::Merged
    } else if raw.state.as_deref() == Some("closed") {
        PullRequestState::Closed
    } else {
        PullRequestState::Open
    };
    let author = raw.user.map(project_user).unwrap_or_default();
    PullRequestDetail {
        number: raw.number,
        title: raw.title.unwrap_or_default(),
        state,
        draft: raw.draft,
        author,
        created_at: raw.created_at.unwrap_or_default(),
        updated_at: raw.updated_at.unwrap_or_default(),
        closed_at: raw.closed_at,
        merged_at: raw.merged_at,
        html_url: raw.html_url.unwrap_or_default(),
        base_ref: raw
            .base
            .as_ref()
            .map(|b| b.ref_name.clone())
            .unwrap_or_default(),
        head_ref: raw
            .head
            .as_ref()
            .map(|h| h.ref_name.clone())
            .unwrap_or_default(),
        head_sha: raw.head.as_ref().map(|h| h.sha.clone()).unwrap_or_default(),
        body: raw.body.unwrap_or_default(),
        labels: raw
            .labels
            .into_iter()
            .map(|l| Label {
                name: l.name,
                color: l.color.trim_start_matches('#').to_string(),
            })
            .collect(),
        assignees: raw.assignees.into_iter().map(project_user).collect(),
        requested_reviewers: raw
            .requested_reviewers
            .into_iter()
            .map(project_user)
            .collect(),
        milestone: raw.milestone.and_then(|m| m.title),
        mergeable: raw.mergeable,
        // Gitea doesn't surface a verbose `mergeable_state` — synthesise
        // from the boolean so the action-button cluster can still gate
        // the Merge button on a non-null value.
        mergeable_state: raw.mergeable.map(|m| {
            if m {
                "clean".to_string()
            } else {
                "dirty".to_string()
            }
        }),
        additions: raw.additions.unwrap_or(0),
        deletions: raw.deletions.unwrap_or(0),
        changed_files: raw.changed_files.unwrap_or(0),
        comments: raw.comments.unwrap_or(0),
        // CI rollup + review decision aren't computed here — see the
        // list-path enrichment (Gitea v1: review aggregate punted; CI
        // is the Checks tab).
        review_decision: None,
        ci_status: None,
        project_settings: None,
    }
}

pub(super) fn project_commit(raw: GiteaCommit) -> PrCommit {
    let short_sha = raw.sha.chars().take(7).collect();
    let inner = raw.commit;
    let author_meta = inner.author.unwrap_or_default();
    let author = raw.author.map(project_user).unwrap_or_else(|| UserInfo {
        display_name: author_meta.name.clone().unwrap_or_default(),
        login: author_meta.name.unwrap_or_default(),
        avatar_url: String::new(),
    });
    PrCommit {
        sha: raw.sha,
        short_sha,
        message: inner.message.unwrap_or_default(),
        author,
        date: author_meta.date.unwrap_or_default(),
    }
}

pub(super) fn project_file(raw: GiteaFile) -> PrFile {
    PrFile {
        filename: raw.filename,
        status: raw.status.unwrap_or_default(),
        additions: raw.additions.unwrap_or(0),
        deletions: raw.deletions.unwrap_or(0),
        patch: raw.patch,
        previous_filename: raw.previous_filename,
    }
}

pub(super) fn project_status(raw: GiteaStatus) -> CheckRun {
    // Gitea statuses are point-in-time — there's no "queued" /
    // "in_progress" / "completed" phase like GitHub check-runs. We
    // pin `status` to "completed" and let `conclusion` carry the
    // actual outcome so the row colouring in the Checks tab keeps
    // working with the existing CSS data-state mapping.
    let conclusion = match raw.status.as_str() {
        "success" => Some("success".to_string()),
        "failure" | "error" => Some("failure".to_string()),
        "warning" => Some("neutral".to_string()),
        "pending" => None,
        other => Some(other.to_string()),
    };
    let status = if raw.status == "pending" {
        "in_progress".to_string()
    } else {
        "completed".to_string()
    };
    CheckRun {
        name: raw.context,
        status,
        conclusion,
        details_url: raw.target_url,
        started_at: raw.created_at,
        completed_at: raw.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pr_state_merged_when_merged_at_set() {
        let raw: GiteaPullDetail = serde_json::from_value(serde_json::json!({
            "number": 1,
            "state": "closed",
            "merged_at": "2026-01-01T00:00:00Z"
        }))
        .unwrap();
        let pr = project_pr(raw);
        assert!(matches!(pr.state, PullRequestState::Merged));
    }

    #[test]
    fn pr_state_closed_distinct_from_merged() {
        let raw: GiteaPullDetail = serde_json::from_value(serde_json::json!({
            "number": 1,
            "state": "closed"
        }))
        .unwrap();
        let pr = project_pr(raw);
        assert!(matches!(pr.state, PullRequestState::Closed));
    }

    #[test]
    fn pr_mergeable_state_synthesised_from_boolean() {
        let clean: GiteaPullDetail = serde_json::from_value(serde_json::json!({
            "number": 1,
            "state": "open",
            "mergeable": true
        }))
        .unwrap();
        assert_eq!(project_pr(clean).mergeable_state.as_deref(), Some("clean"));

        let dirty: GiteaPullDetail = serde_json::from_value(serde_json::json!({
            "number": 1,
            "state": "open",
            "mergeable": false
        }))
        .unwrap();
        assert_eq!(project_pr(dirty).mergeable_state.as_deref(), Some("dirty"));
    }

    #[test]
    fn status_pending_maps_to_in_progress_with_null_conclusion() {
        let raw: GiteaStatus = serde_json::from_value(serde_json::json!({
            "context": "build",
            "status": "pending"
        }))
        .unwrap();
        let check = project_status(raw);
        assert_eq!(check.status, "in_progress");
        assert!(check.conclusion.is_none());
    }

    #[test]
    fn status_error_maps_to_failure_conclusion() {
        let raw: GiteaStatus = serde_json::from_value(serde_json::json!({
            "context": "lint",
            "status": "error"
        }))
        .unwrap();
        assert_eq!(project_status(raw).conclusion.as_deref(), Some("failure"));
    }

    #[test]
    fn label_color_strips_hash_prefix() {
        let raw: GiteaPullDetail = serde_json::from_value(serde_json::json!({
            "number": 1,
            "state": "open",
            "labels": [{ "name": "bug", "color": "#d93f0b" }]
        }))
        .unwrap();
        let pr = project_pr(raw);
        assert_eq!(pr.labels[0].color, "d93f0b");
    }
}
