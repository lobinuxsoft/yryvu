// SPDX-License-Identifier: AGPL-3.0-or-later

//! GraphQL wire types for the GitLab merge-request endpoints + their
//! projections onto yryvu's cross-provider shapes. Shared by `prs.rs`
//! (list) and `search.rs` (filtered list) — they request the same node
//! columns, so the DTOs live here rather than in either consumer.

use serde::Deserialize;

use super::super::types::{Label, UserInfo};

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(super) struct GlMrsResp {
    #[serde(default)]
    pub data: Option<GlMrsData>,
    #[serde(default)]
    pub errors: Option<Vec<GlGraphqlError>>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlMrsData {
    pub project: Option<GlProject>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GlProject {
    pub merge_requests: GlMrConnection,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlMrConnection {
    pub nodes: Vec<GlMrNode>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct GlMrNode {
    pub iid: Option<String>,
    pub title: Option<String>,
    pub state: Option<String>,
    pub draft: Option<bool>,
    pub web_url: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub target_branch: Option<String>,
    pub source_branch: Option<String>,
    pub sha: Option<String>,
    pub author: Option<GlUser>,
    pub labels: Option<GlLabelConnection>,
    pub assignees: Option<GlUserConnection>,
    pub reviewers: Option<GlUserConnection>,
    pub approvals_required: Option<i32>,
    pub approvals_left: Option<i32>,
    /// Present in the response shape but not consumed: the
    /// `approvalsRequired` / `approvalsLeft` pair is sufficient for
    /// the ReviewDecision derivation. Kept for forward-compat so a
    /// future surface ("Approved by X, Y") can drop right in.
    #[allow(dead_code)]
    pub approved_by: Option<GlUserConnection>,
    pub head_pipeline: Option<GlPipeline>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct GlUser {
    pub username: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlUserConnection {
    pub nodes: Vec<GlUser>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlLabelConnection {
    pub nodes: Vec<GlLabelNode>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlLabelNode {
    pub title: String,
    pub color: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GlPipeline {
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(super) struct GlGraphqlError {
    pub message: String,
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

/// GitLab returns label colours WITH the leading `#`; the canonical
/// hex shape used by `Label` (and the GitHub adapter) strips it so
/// frontend CSS rules apply uniformly.
impl From<GlLabelNode> for Label {
    fn from(raw: GlLabelNode) -> Self {
        Self {
            name: raw.title,
            color: raw.color.trim_start_matches('#').to_string(),
        }
    }
}
