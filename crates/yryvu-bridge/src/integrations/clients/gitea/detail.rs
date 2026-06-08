// SPDX-License-Identifier: AGPL-3.0-or-later

//! Gitea / Forgejo PR detail endpoints (REST v1). Returns the
//! cross-provider [`PullRequestDetail`] / [`PrCommit`] / [`PrFile`] /
//! [`CheckRun`] shapes so the panel renders provider-agnostic.
//!
//! Gitea uses the legacy /statuses endpoint for CI rollup (no
//! check-runs concept upstream); the projector maps each commit
//! status to a `CheckRun` row.

use reqwest::Method;

use crate::backend::BackendError;

use super::super::github::{CheckRun, PrCommit, PrFile, PullRequestDetail};
use super::super::http::{self, GITEA_QUIRKS};
use super::api_base;
use super::pr_wire::{
    project_commit, project_file, project_pr, project_status, GiteaCommit, GiteaFile,
    GiteaPullDetail, GiteaStatus,
};

/// Fetch the full PR record. Single REST round-trip. Gitea returns
/// the same shape as the list path but with extra fields (body,
/// mergeable, counts).
pub async fn get_pr_detail(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    index: u64,
) -> Result<PullRequestDetail, BackendError> {
    let raw: GiteaPullDetail = get_json(
        token,
        &format!("{}/repos/{owner}/{repo}/pulls/{index}", api_base(hostname)?),
    )
    .await?;
    Ok(project_pr(raw))
}

/// Fetch the commits attached to a PR.
pub async fn list_pr_commits(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    index: u64,
) -> Result<Vec<PrCommit>, BackendError> {
    let raw: Vec<GiteaCommit> = get_json(
        token,
        &format!(
            "{}/repos/{owner}/{repo}/pulls/{index}/commits?limit=100",
            api_base(hostname)?
        ),
    )
    .await?;
    Ok(raw.into_iter().map(project_commit).collect())
}

/// Fetch the changed-files list for a PR.
pub async fn list_pr_files(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    index: u64,
) -> Result<Vec<PrFile>, BackendError> {
    let raw: Vec<GiteaFile> = get_json(
        token,
        &format!(
            "{}/repos/{owner}/{repo}/pulls/{index}/files?limit=100",
            api_base(hostname)?
        ),
    )
    .await?;
    Ok(raw.into_iter().map(project_file).collect())
}

/// Fetch CI status rows for a commit. Gitea/Forgejo expose the
/// legacy `/statuses/{sha}` surface — one row per CI context — which
/// we map onto `CheckRun` so the Checks tab renders unchanged.
pub async fn list_pr_checks(
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    head_sha: &str,
) -> Result<Vec<CheckRun>, BackendError> {
    let raw: Vec<GiteaStatus> = get_json(
        token,
        &format!(
            "{}/repos/{owner}/{repo}/statuses/{head_sha}?limit=100",
            api_base(hostname)?
        ),
    )
    .await?;
    Ok(raw.into_iter().map(project_status).collect())
}

async fn get_json<T: serde::de::DeserializeOwned>(
    token: &str,
    url: &str,
) -> Result<T, BackendError> {
    let client = http::client()?;
    let req = http::authed(&client, Method::GET, url, token, "application/json");
    let resp = http::execute(req, GITEA_QUIRKS).await?;
    resp.json()
        .await
        .map_err(|e| http::decode_error("decoding PR detail response", e))
}
