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

pub use gitea::{
    create_issue as create_gitea_issue, create_pr as create_gitea_pr,
    get_issue_detail as get_gitea_issue_detail, get_pr_detail as get_gitea_pr_detail,
    list_collaborators as list_gitea_collaborators, list_issues as list_gitea_issues,
    list_labels as list_gitea_labels, list_milestones as list_gitea_milestones,
    list_pr_checks as list_gitea_pr_checks, list_pr_commits as list_gitea_pr_commits,
    list_pr_files as list_gitea_pr_files, list_prs as list_gitea_prs, merge_pr as gitea_merge_pr,
    pr_action as gitea_pr_action, search_prs as search_gitea_prs,
};
pub use github::{
    create_issue as create_github_issue, create_pr as create_github_pr,
    delete_branch as github_delete_branch, enrich_prs as enrich_github_prs,
    get_issue_detail as get_github_issue_detail, get_pr_detail as get_github_pr_detail,
    list_collaborators as list_github_collaborators, list_issues as list_github_issues,
    list_labels as list_github_labels, list_milestones as list_github_milestones,
    list_pr_checks as list_github_pr_checks, list_pr_commits as list_github_pr_commits,
    list_pr_files as list_github_pr_files, merge_pr as github_merge_pr,
    pr_action as github_pr_action, search_prs as search_github_prs, CheckRun, CiStatus,
    MergeMethod, MergeRequest, PrAction, PrCommit, PrFile, PullRequestDetail, PullRequestState,
    PullRequestSummary, ReviewDecision,
};
pub use gitlab::{
    create_issue as create_gitlab_issue, create_pr as create_gitlab_pr,
    get_issue_detail as get_gitlab_issue_detail, get_mr_detail as get_gitlab_mr_detail,
    list_collaborators as list_gitlab_collaborators, list_issues as list_gitlab_issues,
    list_labels as list_gitlab_labels, list_milestones as list_gitlab_milestones,
    list_mr_commits as list_gitlab_mr_commits, list_mr_files as list_gitlab_mr_files,
    list_mr_pipelines as list_gitlab_mr_pipelines, list_mrs as list_gitlab_mrs,
    merge_mr as gitlab_merge_mr, mr_action as gitlab_mr_action, rebase_mr as gitlab_rebase_mr,
    search_mrs as search_gitlab_mrs, MrAction,
};
pub use types::{
    Comment, CommentTarget, CreateCommentInput, CreateIssueInput, CreatePrInput, Identifier,
    IssueDetail, IssueState, IssueSummary, Label, ProjectMergeMethod, ProjectMergeSettings,
    ProjectSquashOption, UserInfo,
};

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

/// Dispatcher: fetch one issue's detail via the matching provider's
/// client. Returns the shared [`IssueDetail`] shape — the panel
/// renders provider-agnostic.
pub async fn get_issue_detail(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<IssueDetail, BackendError> {
    match integration_type {
        "github" => github::get_issue_detail(token, None, owner, repo, number).await,
        "githubEnterprise" => github::get_issue_detail(token, hostname, owner, repo, number).await,
        "gitlab" => gitlab::get_issue_detail(token, None, owner, repo, number).await,
        "gitlabSelfHosted" => gitlab::get_issue_detail(token, hostname, owner, repo, number).await,
        "gitea" => gitea::get_issue_detail(token, None, owner, repo, number).await,
        "giteaSelfHosted" => gitea::get_issue_detail(token, hostname, owner, repo, number).await,
        _ => Err(BackendError::NotImplemented(
            "issue detail not implemented for this provider",
        )),
    }
}

/// Dispatcher: list comments for an issue or pull/merge request.
pub async fn list_comments(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    target: types::CommentTarget,
    number: u64,
) -> Result<Vec<types::Comment>, BackendError> {
    match integration_type {
        "github" => github::list_comments(token, None, owner, repo, target, number).await,
        "githubEnterprise" => {
            github::list_comments(token, hostname, owner, repo, target, number).await
        }
        "gitlab" => gitlab::list_comments(token, None, owner, repo, target, number).await,
        "gitlabSelfHosted" => {
            gitlab::list_comments(token, hostname, owner, repo, target, number).await
        }
        "gitea" => gitea::list_comments(token, None, owner, repo, target, number).await,
        "giteaSelfHosted" => {
            gitea::list_comments(token, hostname, owner, repo, target, number).await
        }
        _ => Err(BackendError::NotImplemented(
            "comments listing not implemented for this provider",
        )),
    }
}

/// Dispatcher: post a new comment to an issue or pull/merge request.
/// Eight parameters — the dispatch contract just mirrors the per-
/// provider call signature; collapsing into a struct adds plumbing
/// without buying anything because every callsite passes exactly
/// these fields straight through.
#[allow(clippy::too_many_arguments)]
pub async fn create_comment(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    target: types::CommentTarget,
    number: u64,
    input: &types::CreateCommentInput,
) -> Result<types::Comment, BackendError> {
    match integration_type {
        "github" => github::create_comment(token, None, owner, repo, target, number, input).await,
        "githubEnterprise" => {
            github::create_comment(token, hostname, owner, repo, target, number, input).await
        }
        "gitlab" => gitlab::create_comment(token, None, owner, repo, target, number, input).await,
        "gitlabSelfHosted" => {
            gitlab::create_comment(token, hostname, owner, repo, target, number, input).await
        }
        "gitea" => gitea::create_comment(token, None, owner, repo, target, number, input).await,
        "giteaSelfHosted" => {
            gitea::create_comment(token, hostname, owner, repo, target, number, input).await
        }
        _ => Err(BackendError::NotImplemented(
            "comment creation not implemented for this provider",
        )),
    }
}

/// Dispatcher: list repository labels — populates the labels
/// dropdown in the Create Issue / Create PR forms.
pub async fn list_labels(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<types::Identifier>, BackendError> {
    match integration_type {
        "github" => github::list_labels(token, None, owner, repo).await,
        "githubEnterprise" => github::list_labels(token, hostname, owner, repo).await,
        "gitlab" => gitlab::list_labels(token, None, owner, repo).await,
        "gitlabSelfHosted" => gitlab::list_labels(token, hostname, owner, repo).await,
        "gitea" => gitea::list_labels(token, None, owner, repo).await,
        "giteaSelfHosted" => gitea::list_labels(token, hostname, owner, repo).await,
        _ => Err(BackendError::NotImplemented(
            "labels listing not implemented for this provider",
        )),
    }
}

/// Dispatcher: list repository collaborators — populates assignees
/// and reviewers dropdowns.
pub async fn list_collaborators(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<types::Identifier>, BackendError> {
    match integration_type {
        "github" => github::list_collaborators(token, None, owner, repo).await,
        "githubEnterprise" => github::list_collaborators(token, hostname, owner, repo).await,
        "gitlab" => gitlab::list_collaborators(token, None, owner, repo).await,
        "gitlabSelfHosted" => gitlab::list_collaborators(token, hostname, owner, repo).await,
        "gitea" => gitea::list_collaborators(token, None, owner, repo).await,
        "giteaSelfHosted" => gitea::list_collaborators(token, hostname, owner, repo).await,
        _ => Err(BackendError::NotImplemented(
            "collaborators listing not implemented for this provider",
        )),
    }
}

/// Dispatcher: list open repository milestones — populates the
/// milestone selector. Closed milestones are filtered upstream since
/// the dropdown only offers valid choices for new items.
pub async fn list_milestones(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<types::Identifier>, BackendError> {
    match integration_type {
        "github" => github::list_milestones(token, None, owner, repo).await,
        "githubEnterprise" => github::list_milestones(token, hostname, owner, repo).await,
        "gitlab" => gitlab::list_milestones(token, None, owner, repo).await,
        "gitlabSelfHosted" => gitlab::list_milestones(token, hostname, owner, repo).await,
        "gitea" => gitea::list_milestones(token, None, owner, repo).await,
        "giteaSelfHosted" => gitea::list_milestones(token, hostname, owner, repo).await,
        _ => Err(BackendError::NotImplemented(
            "milestones listing not implemented for this provider",
        )),
    }
}

/// Dispatcher: create a new pull / merge request on `owner/repo` via
/// the matching provider's client. Returns the freshly created
/// [`PullRequestDetail`] so the UI can route into the detail panel
/// without a follow-up GET. Gitea has no `get_pr_detail` yet so its
/// creation surface lands together with that work — until then, the
/// dispatcher bubbles `NotImplemented` for Gitea.
pub async fn create_pr(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    input: &types::CreatePrInput,
) -> Result<PullRequestDetail, BackendError> {
    match integration_type {
        "github" => github::create_pr(token, None, owner, repo, input).await,
        "githubEnterprise" => github::create_pr(token, hostname, owner, repo, input).await,
        "gitlab" => gitlab::create_pr(token, None, owner, repo, input).await,
        "gitlabSelfHosted" => gitlab::create_pr(token, hostname, owner, repo, input).await,
        "gitea" => gitea::create_pr(token, None, owner, repo, input).await,
        "giteaSelfHosted" => gitea::create_pr(token, hostname, owner, repo, input).await,
        _ => Err(BackendError::NotImplemented(
            "PR creation not implemented for this provider",
        )),
    }
}

/// Dispatcher: create a new issue on `owner/repo` via the matching
/// provider's client. Returns the freshly created [`IssueDetail`] so
/// the UI can route to the detail panel without a follow-up GET.
pub async fn create_issue(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
    input: &CreateIssueInput,
) -> Result<IssueDetail, BackendError> {
    match integration_type {
        "github" => github::create_issue(token, None, owner, repo, input).await,
        "githubEnterprise" => github::create_issue(token, hostname, owner, repo, input).await,
        "gitlab" => gitlab::create_issue(token, None, owner, repo, input).await,
        "gitlabSelfHosted" => gitlab::create_issue(token, hostname, owner, repo, input).await,
        "gitea" => gitea::create_issue(token, None, owner, repo, input).await,
        "giteaSelfHosted" => gitea::create_issue(token, hostname, owner, repo, input).await,
        _ => Err(BackendError::NotImplemented(
            "issue creation not implemented for this provider",
        )),
    }
}

/// Dispatcher: list issues for `owner/repo` via the matching
/// provider's client. Mirrors [`list_prs`] dispatch shape — each
/// supported provider returns the shared [`IssueSummary`].
pub async fn list_issues(
    integration_type: &str,
    token: &str,
    hostname: Option<&str>,
    owner: &str,
    repo: &str,
) -> Result<Vec<IssueSummary>, BackendError> {
    match integration_type {
        "github" => github::list_issues(token, None, owner, repo).await,
        "githubEnterprise" => github::list_issues(token, hostname, owner, repo).await,
        "gitlab" => gitlab::list_issues(token, None, owner, repo).await,
        "gitlabSelfHosted" => gitlab::list_issues(token, hostname, owner, repo).await,
        "gitea" => gitea::list_issues(token, None, owner, repo).await,
        "giteaSelfHosted" => gitea::list_issues(token, hostname, owner, repo).await,
        other => Err(BackendError::NotImplemented(match other {
            "bitbucket" | "bitbucketServer" => "Bitbucket issues (lands in its own PR)",
            "azureDevops" => "Azure DevOps issues (lands in its own PR)",
            "jiraCloud" | "jiraServer" => "Jira issue tracker (lands in its own PR)",
            "trello" => "Trello not in yryvu v1 scope",
            _ => "unknown integration type",
        })),
    }
}
