// SPDX-License-Identifier: AGPL-3.0-or-later

//! Per-provider API clients. Each submodule owns one provider's
//! preflight + future per-feature calls (PR list, issue list, etc).
//!
//! Mirror of GK's `crates/yryvu-bridge/src/api/<provider>.rs`
//! suggestion in `docs/research/gitkraken-integrations/10-yryvu-implementation-hints.md`.
//!
//! Routing happens at [`preflight`] which dispatches by integration
//! type. Providers without a client yet return
//! [`BackendError::NotImplemented`] — UI degrades gracefully (the
//! integration stays in the "mocked connect" path).

mod gitea;
mod github;
mod gitlab;
mod http;
mod types;

pub use gitea::{list_prs as list_gitea_prs, search_prs as search_gitea_prs};
pub use github::{
    delete_branch as github_delete_branch, enrich_prs as enrich_github_prs,
    get_pr_detail as get_github_pr_detail, list_pr_checks as list_github_pr_checks,
    list_pr_commits as list_github_pr_commits, list_pr_files as list_github_pr_files,
    merge_pr as github_merge_pr, pr_action as github_pr_action, search_prs as search_github_prs,
    CheckRun, CiStatus, MergeMethod, MergeRequest, PrAction, PrCommit, PrFile, PullRequestDetail,
    PullRequestState, PullRequestSummary, ReviewDecision,
};
pub use gitlab::{list_mrs as list_gitlab_mrs, search_mrs as search_gitlab_mrs};
pub use types::{Label, UserInfo};

use crate::backend::BackendError;

/// Dispatcher: validate `token` and fetch user info for whichever
/// provider `integration_type` names. Currently routes the GitHub and
/// GitLab flavours; other providers return
/// [`BackendError::NotImplemented`] until their per-provider clients
/// land (#17 Gitea, plus Bitbucket / Azure / Jira if those ever come
/// in scope).
pub async fn preflight(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
) -> Result<UserInfo, BackendError> {
    match integration_type {
        "github" => github::preflight_github(token, None).await,
        "githubEnterprise" => github::preflight_github(token, hostname).await,
        "gitlab" => gitlab::preflight_gitlab(token, None).await,
        "gitlabSelfHosted" => gitlab::preflight_gitlab(token, hostname).await,
        "gitea" => gitea::preflight_gitea(token, None).await,
        "giteaSelfHosted" => gitea::preflight_gitea(token, hostname).await,
        other => Err(BackendError::NotImplemented(match other {
            "bitbucket" | "bitbucketServer" => "Bitbucket preflight (lands in its own PR)",
            "azureDevops" => "Azure DevOps preflight (lands in its own PR)",
            "jiraCloud" | "jiraServer" => "Jira preflight (lands in its own PR)",
            "trello" => "Trello not in yryvu v1 scope",
            _ => "unknown integration type",
        })),
    }
}

/// Dispatcher: list pull / merge requests for `owner/repo` via the
/// matching provider's client. Mirrors [`preflight`] dispatch shape so
/// the command layer stays uniform across surfaces. The GitLab variant
/// emits a "merge request" in API terms; yryvu (mirroring GK) surfaces
/// both as `PullRequestSummary` so the row UI stays one component.
pub async fn list_prs(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<PullRequestSummary>, BackendError> {
    match integration_type {
        "github" => github::list_prs(token, None, owner, repo).await,
        "githubEnterprise" => github::list_prs(token, hostname, owner, repo).await,
        "gitlab" => gitlab::list_mrs(token, None, owner, repo).await,
        "gitlabSelfHosted" => gitlab::list_mrs(token, hostname, owner, repo).await,
        "gitea" => gitea::list_prs(token, None, owner, repo).await,
        "giteaSelfHosted" => gitea::list_prs(token, hostname, owner, repo).await,
        other => Err(BackendError::NotImplemented(match other {
            "bitbucket" | "bitbucketServer" => "Bitbucket PR list (lands in its own PR)",
            "azureDevops" => "Azure DevOps PR list (lands in its own PR)",
            "jiraCloud" | "jiraServer" => "Jira has no PR concept — issue tracker instead",
            "trello" => "Trello not in yryvu v1 scope",
            _ => "unknown integration type",
        })),
    }
}
