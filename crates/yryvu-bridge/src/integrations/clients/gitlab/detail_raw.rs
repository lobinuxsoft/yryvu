// SPDX-License-Identifier: AGPL-3.0-or-later

//! Raw deserializer structs + `From` projections for [`super::detail`].
//! Split from the main module to keep both files under the 400 LOC
//! cap. Visibility is `pub(super)` on the types `detail.rs` names
//! directly; the `From` impls + helper fns are crate-private — no
//! callsite outside this folder talks to these shapes.
//!
//! Structs here are built indirectly via `serde`'s derived
//! `Deserialize`; rustc's reachability analysis doesn't follow that
//! path, so the module-level allow keeps the noise out of the lint
//! output.

#![allow(dead_code)]

use serde::Deserialize;

use super::super::github::{
    CheckRun, CiStatus, PrCommit, PrFile, PullRequestDetail, PullRequestState, ReviewDecision,
};
use super::super::types::{Label, UserInfo};

#[derive(Debug, Deserialize)]
pub(super) struct GlDetailResp {
    #[serde(default)]
    pub(super) data: Option<GlDetailData>,
    #[serde(default)]
    pub(super) errors: Option<Vec<GlGraphqlError>>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlDetailData {
    #[serde(default)]
    pub(super) project: Option<GlDetailProject>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GlDetailProject {
    #[serde(default)]
    pub(super) merge_request: Option<GlMrDetail>,
    /// `MERGE` | `FF` | `REBASE_MERGE` — gates which method radios the
    /// frontend offers in the merge form.
    #[serde(default)]
    pub(super) merge_method: Option<String>,
    /// `never` | `always` | `default_off` | `default_on` — gates the
    /// independent squash checkbox.
    #[serde(default)]
    pub(super) squash_option: Option<String>,
    #[serde(default)]
    pub(super) remove_source_branch_after_merge: Option<bool>,
    #[serde(default)]
    pub(super) allow_merge_on_skipped_pipeline: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GlMrDetail {
    pub(super) iid: String,
    pub(super) title: String,
    pub(super) description: Option<String>,
    pub(super) state: String,
    pub(super) draft: bool,
    pub(super) web_url: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) target_branch: String,
    pub(super) source_branch: String,
    pub(super) sha: Option<String>,
    pub(super) merge_status: Option<String>,
    pub(super) user_notes_count: u64,
    pub(super) diff_stats_summary: Option<GlDiffStats>,
    pub(super) author: Option<GlUser>,
    pub(super) labels: Option<GlLabelConn>,
    pub(super) assignees: Option<GlUserConn>,
    pub(super) reviewers: Option<GlUserConn>,
    pub(super) milestone: Option<GlMilestone>,
    pub(super) approvals_required: Option<i32>,
    pub(super) approvals_left: Option<i32>,
    pub(super) head_pipeline: Option<GlHeadPipeline>,
    pub(super) closed_at: Option<String>,
    pub(super) merged_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlDiffStats {
    pub(super) additions: Option<u64>,
    pub(super) deletions: Option<u64>,
    pub(super) file_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GlUser {
    pub(super) username: String,
    pub(super) name: Option<String>,
    pub(super) avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlUserConn {
    pub(super) nodes: Vec<GlUser>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlLabelConn {
    pub(super) nodes: Vec<GlLabelNode>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlLabelNode {
    pub(super) title: String,
    pub(super) color: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlMilestone {
    pub(super) title: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlHeadPipeline {
    pub(super) status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(super) struct GlGraphqlError {
    pub(super) message: String,
}

impl From<GlUser> for UserInfo {
    fn from(raw: GlUser) -> Self {
        Self {
            display_name: raw.name.clone().unwrap_or_else(|| raw.username.clone()),
            login: raw.username,
            avatar_url: raw.avatar_url.unwrap_or_default(),
        }
    }
}

impl From<GlLabelNode> for Label {
    fn from(raw: GlLabelNode) -> Self {
        Self {
            name: raw.title,
            color: raw.color.trim_start_matches('#').to_string(),
        }
    }
}

impl From<GlMrDetail> for PullRequestDetail {
    fn from(raw: GlMrDetail) -> Self {
        let state = match (raw.merged_at.is_some(), raw.state.as_str()) {
            (true, _) => PullRequestState::Merged,
            (_, "closed") | (_, "locked") => PullRequestState::Closed,
            _ => PullRequestState::Open,
        };
        let stats = raw.diff_stats_summary.unwrap_or(GlDiffStats {
            additions: None,
            deletions: None,
            file_count: None,
        });
        let users = |conn: Option<GlUserConn>| -> Vec<UserInfo> {
            conn.map(|c| c.nodes.into_iter().map(UserInfo::from).collect())
                .unwrap_or_default()
        };
        Self {
            number: raw.iid.parse().unwrap_or(0),
            title: raw.title,
            state,
            draft: raw.draft,
            author: raw.author.map(UserInfo::from).unwrap_or(UserInfo {
                display_name: String::new(),
                login: String::new(),
                avatar_url: String::new(),
            }),
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            closed_at: raw.closed_at,
            merged_at: raw.merged_at,
            html_url: raw.web_url,
            base_ref: raw.target_branch,
            head_ref: raw.source_branch,
            head_sha: raw.sha.unwrap_or_default(),
            body: raw.description.unwrap_or_default(),
            labels: raw
                .labels
                .map(|l| l.nodes.into_iter().map(Label::from).collect())
                .unwrap_or_default(),
            assignees: users(raw.assignees),
            requested_reviewers: users(raw.reviewers),
            milestone: raw.milestone.and_then(|m| m.title),
            // GitLab `mergeStatus` maps to `mergeable` semantics:
            // `can_be_merged` → true, `cannot_be_merged` → false,
            // anything else (checking, unchecked) → None.
            mergeable: match raw.merge_status.as_deref() {
                Some("can_be_merged") => Some(true),
                Some("cannot_be_merged") => Some(false),
                _ => None,
            },
            mergeable_state: raw.merge_status,
            additions: stats.additions.unwrap_or(0),
            deletions: stats.deletions.unwrap_or(0),
            changed_files: stats.file_count.unwrap_or(0),
            comments: raw.user_notes_count,
            review_decision: derive_review_decision(raw.approvals_required, raw.approvals_left),
            ci_status: raw
                .head_pipeline
                .and_then(|p| p.status.as_deref().and_then(parse_ci)),
            // Filled in at the project-level projection in
            // [`super::detail::get_mr_detail`] — the From only sees the
            // MR scope.
            project_settings: None,
        }
    }
}

/// Match GitLab `mergeStatus` to a `mergeable_state`-style verb the
/// frontend already understands. GitLab returns `can_be_merged` /
/// `cannot_be_merged` / `unchecked` / `checking`; the frontend's
/// merge-button gate disables for anything except the canonical
/// `clean`, so we translate. The merge form is on the GitHub side
/// today; until GitLab merge form lands (#94), this is informational.
pub(super) fn derive_review_decision(
    required: Option<i32>,
    left: Option<i32>,
) -> Option<ReviewDecision> {
    let required = required?;
    if required <= 0 {
        return None;
    }
    Some(match left.unwrap_or(required) {
        n if n <= 0 => ReviewDecision::Approved,
        _ => ReviewDecision::ReviewRequired,
    })
}

pub(super) fn parse_ci(raw: &str) -> Option<CiStatus> {
    match raw {
        "SUCCESS" | "success" => Some(CiStatus::Success),
        "FAILED" | "failed" => Some(CiStatus::Failure),
        "PENDING"
        | "RUNNING"
        | "PREPARING"
        | "WAITING_FOR_RESOURCE"
        | "CREATED"
        | "pending"
        | "running"
        | "preparing"
        | "waiting_for_resource"
        | "created" => Some(CiStatus::Pending),
        "MANUAL" | "SCHEDULED" | "manual" | "scheduled" => Some(CiStatus::Expected),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct GlCommit {
    pub(super) id: String,
    pub(super) message: String,
    pub(super) author_name: Option<String>,
    pub(super) author_email: Option<String>,
    pub(super) authored_date: Option<String>,
}

impl From<GlCommit> for PrCommit {
    fn from(raw: GlCommit) -> Self {
        let short_sha = raw.id.chars().take(7).collect();
        let login = raw
            .author_name
            .clone()
            .unwrap_or_else(|| raw.author_email.clone().unwrap_or_default());
        Self {
            sha: raw.id,
            short_sha,
            message: raw.message,
            author: UserInfo {
                display_name: raw.author_name.unwrap_or_else(|| login.clone()),
                login,
                avatar_url: String::new(),
            },
            date: raw.authored_date.unwrap_or_default(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct GlChangesResp {
    pub(super) changes: Vec<GlChange>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlChange {
    pub(super) old_path: Option<String>,
    pub(super) new_path: Option<String>,
    #[serde(default)]
    pub(super) new_file: bool,
    #[serde(default)]
    pub(super) renamed_file: bool,
    #[serde(default)]
    pub(super) deleted_file: bool,
    pub(super) diff: Option<String>,
}

impl From<GlChange> for PrFile {
    fn from(raw: GlChange) -> Self {
        let status = match (raw.new_file, raw.deleted_file, raw.renamed_file) {
            (true, _, _) => "added",
            (_, true, _) => "removed",
            (_, _, true) => "renamed",
            _ => "modified",
        }
        .to_string();
        let (additions, deletions) = count_diff_lines(raw.diff.as_deref());
        let filename = raw.new_path.clone().unwrap_or_default();
        let previous_filename = if raw.renamed_file { raw.old_path } else { None };
        Self {
            filename,
            status,
            additions,
            deletions,
            patch: raw.diff,
            previous_filename,
        }
    }
}

/// GitLab's `/changes` payload doesn't ship per-file +/- counts;
/// derive them from the unified diff. Lines starting with `+` are
/// additions; with `-` deletions; `+++` / `---` headers are excluded.
pub(super) fn count_diff_lines(diff: Option<&str>) -> (u64, u64) {
    let Some(diff) = diff else {
        return (0, 0);
    };
    let mut adds: u64 = 0;
    let mut dels: u64 = 0;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            adds += 1;
        } else if line.starts_with('-') {
            dels += 1;
        }
    }
    (adds, dels)
}

#[derive(Debug, Deserialize)]
pub(super) struct GlPipeline {
    pub(super) id: u64,
    pub(super) status: String,
    pub(super) web_url: Option<String>,
    pub(super) created_at: Option<String>,
    pub(super) updated_at: Option<String>,
}

impl From<GlPipeline> for CheckRun {
    fn from(raw: GlPipeline) -> Self {
        let conclusion = match raw.status.as_str() {
            "success" => Some("success".to_string()),
            "failed" => Some("failure".to_string()),
            "canceled" => Some("cancelled".to_string()),
            "skipped" => Some("skipped".to_string()),
            _ => None,
        };
        let status = match raw.status.as_str() {
            "success" | "failed" | "canceled" | "skipped" => "completed".to_string(),
            "running" | "pending" | "preparing" | "waiting_for_resource" | "created" => {
                "in_progress".to_string()
            }
            "manual" | "scheduled" => "queued".to_string(),
            other => other.to_string(),
        };
        Self {
            name: format!("Pipeline #{}", raw.id),
            status,
            conclusion,
            details_url: raw.web_url,
            started_at: raw.created_at,
            completed_at: raw.updated_at,
        }
    }
}
