// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::BackendError;

use super::common::{git2_err, open_git2};

pub fn build_credentials_callbacks() -> git2::RemoteCallbacks<'static> {
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(|url, username_from_url, allowed| {
        if allowed.contains(git2::CredentialType::SSH_KEY) {
            let user = username_from_url.unwrap_or("git");
            if let Ok(cred) = git2::Cred::ssh_key_from_agent(user) {
                return Ok(cred);
            }
        }
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Ok(cfg) = git2::Config::open_default() {
                if let Ok(cred) = git2::Cred::credential_helper(&cfg, url, username_from_url) {
                    return Ok(cred);
                }
            }
        }
        if allowed.contains(git2::CredentialType::DEFAULT) {
            if let Ok(cred) = git2::Cred::default() {
                return Ok(cred);
            }
        }
        Err(git2::Error::from_str(
            "no credentials available (tried SSH agent, git credential helper, default)",
        ))
    });
    callbacks
}

pub fn delete_remote_branch(
    repo_path: &Path,
    remote: &str,
    name: &str,
) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let mut remote_obj = repo
        .find_remote(remote)
        .map_err(|_| BackendError::RemoteNotFound {
            name: remote.to_string(),
        })?;

    let refspec = format!(":refs/heads/{name}");

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(build_credentials_callbacks());

    remote_obj
        .push(&[&refspec], Some(&mut push_opts))
        .map_err(|e| BackendError::PushFailed(e.to_string()))?;

    // Remove the local tracking ref so the sidebar reflects the deletion
    // without needing a separate fetch --prune cycle.
    let tracking_ref = format!("refs/remotes/{remote}/{name}");
    if let Ok(mut r) = repo.find_reference(&tracking_ref) {
        let _ = r.delete();
    }

    Ok(())
}

/// Push HEAD's branch to its configured upstream. When no upstream is
/// configured, pushes to `origin/<current-branch>` and sets it as the
/// upstream so the next push doesn't need the same nudge.
///
/// Scoped narrow for the commit-and-push flow (issue #143). Full
/// push/pull/fetch wiring with force / force-with-lease / multi-remote
/// selection lives in issue #4.
///
/// BACKEND: git2 — reuses `build_credentials_callbacks` (SSH agent →
/// credential helper → default). gix 0.68 has `remote::Connection::push`
/// but auth plumbing + progress reporting are still pre-stable. Migrate
/// when gix ships a push API matching libgit2's callback surface.
pub fn push_current_branch(repo_path: &Path) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;

    let head = repo
        .head()
        .map_err(|e| BackendError::Git(anyhow::Error::new(e)))?;
    if !head.is_branch() {
        return Err(BackendError::Git(anyhow::anyhow!(
            "HEAD is detached; check out a branch before pushing"
        )));
    }
    let branch_shorthand = head
        .shorthand()
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("could not resolve HEAD branch name")))?
        .to_string();
    let branch_full = head
        .name()
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("could not resolve HEAD ref name")))?
        .to_string();

    let local_branch = repo
        .find_branch(&branch_shorthand, git2::BranchType::Local)
        .map_err(git2_err)?;

    let (remote_name, remote_ref) = match local_branch.upstream() {
        Ok(upstream) => {
            let upstream_full = upstream
                .get()
                .name()
                .ok_or_else(|| {
                    BackendError::Git(anyhow::anyhow!("upstream ref has non-utf8 name"))
                })?
                .to_string();
            // Split `refs/remotes/<remote>/<branch>` into remote + branch.
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
            let remote = without_prefix[..slash].to_string();
            let branch = &without_prefix[slash + 1..];
            (remote, format!("refs/heads/{branch}"))
        }
        Err(_) => ("origin".to_string(), branch_full.clone()),
    };

    let mut remote_obj =
        repo.find_remote(&remote_name)
            .map_err(|_| BackendError::RemoteNotFound {
                name: remote_name.clone(),
            })?;

    let refspec = format!("{branch_full}:{remote_ref}");
    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(build_credentials_callbacks());

    remote_obj
        .push(&[&refspec], Some(&mut push_opts))
        .map_err(|e| BackendError::PushFailed(e.to_string()))?;

    // When we invented the upstream (no tracking previously), persist it.
    if local_branch.upstream().is_err() {
        let mut local_branch = repo
            .find_branch(&branch_shorthand, git2::BranchType::Local)
            .map_err(git2_err)?;
        let upstream_name = format!("{remote_name}/{branch_shorthand}");
        local_branch
            .set_upstream(Some(&upstream_name))
            .map_err(git2_err)?;
    }

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
