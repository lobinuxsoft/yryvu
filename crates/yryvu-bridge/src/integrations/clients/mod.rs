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

mod github;
mod types;

pub use github::{enrich_prs as enrich_github_prs, CiStatus, PullRequestState, PullRequestSummary, ReviewDecision};
pub use types::{Label, UserInfo};

use crate::backend::BackendError;

/// Dispatcher: validate `token` and fetch user info for whichever
/// provider `integration_type` names. Currently routes \`github\`
/// and \`githubEnterprise\` to the GitHub client; other providers
/// return [`BackendError::NotImplemented`] until their per-PR clients
/// land.
pub async fn preflight(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
) -> Result<UserInfo, BackendError> {
    match integration_type {
        "github" => github::preflight_github(token, None).await,
        "githubEnterprise" => github::preflight_github(token, hostname).await,
        other => Err(BackendError::NotImplemented(match other {
            "gitlab" | "gitlabSelfHosted" => "GitLab preflight (lands in its own PR)",
            "bitbucket" | "bitbucketServer" => "Bitbucket preflight (lands in its own PR)",
            "azureDevops" => "Azure DevOps preflight (lands in its own PR)",
            "jiraCloud" | "jiraServer" => "Jira preflight (lands in its own PR)",
            "trello" => "Trello not in yryvu v1 scope",
            _ => "unknown integration type",
        })),
    }
}

/// Dispatcher: list pull requests for `owner/repo` via the matching
/// provider's client. Mirrors [`preflight`] dispatch shape so the
/// command layer stays uniform across surfaces.
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
        other => Err(BackendError::NotImplemented(match other {
            "gitlab" | "gitlabSelfHosted" => "GitLab PR list (lands in its own PR)",
            "bitbucket" | "bitbucketServer" => "Bitbucket PR list (lands in its own PR)",
            "azureDevops" => "Azure DevOps PR list (lands in its own PR)",
            "jiraCloud" | "jiraServer" => "Jira has no PR concept — issue tracker instead",
            "trello" => "Trello not in yryvu v1 scope",
            _ => "unknown integration type",
        })),
    }
}
