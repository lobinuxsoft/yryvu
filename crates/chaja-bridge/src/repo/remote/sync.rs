// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::{BackendError, MergeResult, MergeStrategy};
use crate::repo::common::{git2_err, open_git2};
use crate::repo::merge;

use super::credentials::build_credentials_callbacks;

/// Pull HEAD's branch from a remote: fetch the remote-tracking ref then
/// merge it into HEAD with the requested [`MergeStrategy`].
///
/// `remote` lets the caller force a specific remote (toolbar dropdown);
/// `None` infers the remote from the active branch's upstream config and
/// falls back to `origin` when no upstream is configured. The fetch is
/// performed with prune disabled so an in-flight pull never deletes
/// tracking refs the user might be browsing.
pub fn pull(
    repo_path: &Path,
    remote: Option<&str>,
    strategy: MergeStrategy,
) -> Result<MergeResult, BackendError> {
    let repo = open_git2(repo_path)?;

    let head = repo
        .head()
        .map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
    if !head.is_branch() {
        return Err(BackendError::Git(anyhow::anyhow!(
            "HEAD is detached; check out a branch before pulling"
        )));
    }
    let branch_shorthand = head
        .shorthand()
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("could not resolve HEAD branch name")))?
        .to_string();

    let local_branch = repo
        .find_branch(&branch_shorthand, git2::BranchType::Local)
        .map_err(git2_err)?;

    let (remote_name, upstream_short) = match remote {
        Some(name) => (name.to_string(), format!("{name}/{branch_shorthand}")),
        None => {
            let upstream = local_branch.upstream().map_err(|_| {
                BackendError::Git(anyhow::anyhow!(
                    "branch '{branch_shorthand}' has no upstream; configure one or pass an explicit remote"
                ))
            })?;
            let upstream_full = upstream
                .get()
                .name()
                .ok_or_else(|| {
                    BackendError::Git(anyhow::anyhow!("upstream ref has non-utf8 name"))
                })?
                .to_string();
            let without_prefix = upstream_full.strip_prefix("refs/remotes/").ok_or_else(|| {
                BackendError::Git(anyhow::anyhow!(
                    "unexpected upstream ref shape: {upstream_full}"
                ))
            })?;
            let slash = without_prefix.find('/').ok_or_else(|| {
                BackendError::Git(anyhow::anyhow!(
                    "unexpected upstream ref shape: {upstream_full}"
                ))
            })?;
            (
                without_prefix[..slash].to_string(),
                without_prefix.to_string(),
            )
        }
    };
    drop(local_branch);

    fetch_one(&repo, &remote_name)?;

    merge::merge_branch(repo_path, &upstream_short, strategy)
}

/// Hard-reset HEAD to its upstream, fetching first. Destructive — any
/// local commits that aren't reachable from the upstream are discarded.
/// Surfaced from the toolbar's Pull chevron as `Force pull` and gated
/// behind a confirmation dialog. Refuses on detached HEAD or when no
/// upstream is configured.
pub fn force_pull(repo_path: &Path) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;

    let head = repo
        .head()
        .map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
    if !head.is_branch() {
        return Err(BackendError::Git(anyhow::anyhow!(
            "HEAD is detached; check out a branch before force-pulling"
        )));
    }
    let branch_shorthand = head
        .shorthand()
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("could not resolve HEAD branch name")))?
        .to_string();

    let local_branch = repo
        .find_branch(&branch_shorthand, git2::BranchType::Local)
        .map_err(git2_err)?;

    let upstream = local_branch.upstream().map_err(|_| {
        BackendError::Git(anyhow::anyhow!(
            "branch '{branch_shorthand}' has no upstream; configure one or pull manually"
        ))
    })?;
    let upstream_full = upstream
        .get()
        .name()
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("upstream ref has non-utf8 name")))?
        .to_string();
    let without_prefix = upstream_full.strip_prefix("refs/remotes/").ok_or_else(|| {
        BackendError::Git(anyhow::anyhow!(
            "unexpected upstream ref shape: {upstream_full}"
        ))
    })?;
    let slash = without_prefix.find('/').ok_or_else(|| {
        BackendError::Git(anyhow::anyhow!(
            "unexpected upstream ref shape: {upstream_full}"
        ))
    })?;
    let remote_name = without_prefix[..slash].to_string();
    drop(local_branch);

    fetch_one(&repo, &remote_name)?;

    let upstream_oid = repo
        .refname_to_id(&upstream_full)
        .map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
    let upstream_obj = repo
        .find_object(upstream_oid, None)
        .map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;

    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.reset(&upstream_obj, git2::ResetType::Hard, Some(&mut checkout))
        .map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;

    Ok(())
}

fn fetch_one(repo: &git2::Repository, remote_name: &str) -> Result<(), BackendError> {
    let mut remote_obj =
        repo.find_remote(remote_name)
            .map_err(|_| BackendError::RemoteNotFound {
                name: remote_name.to_string(),
            })?;

    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.prune(git2::FetchPrune::Unspecified);
    fetch_opts.download_tags(git2::AutotagOption::None);
    fetch_opts.remote_callbacks(build_credentials_callbacks());

    remote_obj
        .fetch::<&str>(&[], Some(&mut fetch_opts), None)
        .map_err(|e| BackendError::FetchFailed(e.to_string()))?;
    Ok(())
}

pub fn fetch_prune(repo_path: &Path, remote: Option<&str>) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;

    let remotes_to_fetch: Vec<String> = match remote {
        Some(r) => vec![r.to_string()],
        None => repo
            .remotes()
            .map_err(git2_err)?
            .iter()
            .flatten()
            .map(|s| s.to_string())
            .collect(),
    };

    for remote_name in remotes_to_fetch {
        let mut remote_obj =
            repo.find_remote(&remote_name)
                .map_err(|_| BackendError::RemoteNotFound {
                    name: remote_name.clone(),
                })?;

        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.prune(git2::FetchPrune::On);
        fetch_opts.download_tags(git2::AutotagOption::None);
        fetch_opts.remote_callbacks(build_credentials_callbacks());

        // Empty refspec array → use the remote's configured fetch refspecs.
        remote_obj
            .fetch::<&str>(&[], Some(&mut fetch_opts), None)
            .map_err(|e| BackendError::FetchFailed(e.to_string()))?;
    }

    Ok(())
}
