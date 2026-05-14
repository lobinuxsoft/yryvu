// SPDX-License-Identifier: AGPL-3.0-or-later

//! Raw deserializer structs for the PR detail endpoints. Split from
//! [`super::detail`] to keep the production module under the cap;
//! every type here is `pub(super)` so only the surrounding `github/`
//! module can construct or peek at them.
//!
//! These shapes mirror the GitHub REST envelopes one-to-one. The
//! projection from raw → public types happens in `detail.rs`; the
//! `From` impls don't live here on purpose to keep the file purely
//! about wire format.

use serde::Deserialize;

#[derive(Debug, Deserialize, Default)]
pub(super) struct GhPullDetail {
    pub number: Option<u64>,
    pub title: Option<String>,
    pub state: Option<String>,
    #[serde(default)]
    pub draft: Option<bool>,
    pub merged_at: Option<String>,
    pub closed_at: Option<String>,
    pub user: Option<GhUserMini>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub html_url: Option<String>,
    pub body: Option<String>,
    pub base: Option<GhRef>,
    pub head: Option<GhRef>,
    #[serde(default)]
    pub labels: Option<Vec<GhLabelMini>>,
    #[serde(default)]
    pub assignees: Option<Vec<GhUserMini>>,
    #[serde(default)]
    pub requested_reviewers: Option<Vec<GhUserMini>>,
    pub milestone: Option<GhMilestoneMini>,
    pub mergeable: Option<bool>,
    pub mergeable_state: Option<String>,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub changed_files: Option<u64>,
    pub comments: Option<u64>,
}

#[derive(Debug, Deserialize, Default)]
pub(super) struct GhUserMini {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GhRef {
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub sha: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GhLabelMini {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GhMilestoneMini {
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GhPrCommit {
    pub sha: Option<String>,
    pub commit: Option<GhCommitInner>,
    pub author: Option<GhUserMini>,
}

#[derive(Debug, Deserialize, Default)]
pub(super) struct GhCommitInner {
    pub message: Option<String>,
    pub author: Option<GhCommitAuthor>,
}

#[derive(Debug, Deserialize, Default)]
pub(super) struct GhCommitAuthor {
    pub name: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GhPrFile {
    pub filename: Option<String>,
    pub status: Option<String>,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub patch: Option<String>,
    pub previous_filename: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GhCheckRunsResp {
    pub check_runs: Vec<GhCheckRun>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GhCheckRun {
    pub name: Option<String>,
    pub status: Option<String>,
    pub conclusion: Option<String>,
    pub details_url: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}
