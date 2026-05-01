// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::backend::{BackendError, MergeResult, MergeStrategy, PushOptions};

use super::common::{git2_err, open_git2, open_repo};
use super::hosting::remote_url;
use super::merge;

/// Resolve the fetch URL configured for `remote_name`. Powers the
/// `Copy URL` action on remote-branch and remote-header context menus.
/// Errors with `RemoteNotFound` when the remote is missing or has no
/// fetch URL configured (rare but possible: `git remote add` with
/// `--mirror=push` only).
pub fn get_remote_url(repo_path: &Path, remote_name: &str) -> Result<String, BackendError> {
    let repo = open_repo(repo_path)?;
    remote_url(&repo, remote_name).ok_or_else(|| BackendError::RemoteNotFound {
        name: remote_name.to_string(),
    })
}

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
/// Honours [`PushOptions::force_with_lease`]: when enabled the refspec is
/// prefixed with `+` (allowing non-fast-forward) and the push-negotiation
/// callback verifies the remote tip still matches the local tracking ref.
/// Mismatches surface as [`BackendError::LeaseStale`].
///
/// BACKEND: git2 — reuses `build_credentials_callbacks` (SSH agent →
/// credential helper → default). gix 0.68 has `remote::Connection::push`
/// but auth plumbing + progress reporting are still pre-stable. Migrate
/// when gix ships a push API matching libgit2's callback surface.
pub fn push_current_branch(repo_path: &Path, opts: PushOptions) -> Result<(), BackendError> {
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

    let (remote_name, remote_ref, tracking_ref_full) = match local_branch.upstream() {
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
            (remote, format!("refs/heads/{branch}"), Some(upstream_full))
        }
        Err(_) => ("origin".to_string(), branch_full.clone(), None),
    };

    // Capture the remote tip OID we *expect* to overwrite. Used as the
    // "lease" anchor when force_with_lease is on. Skipped (None) for the
    // first push — by definition there's nothing to clobber.
    let lease_oid = if opts.force_with_lease {
        tracking_ref_full
            .as_deref()
            .and_then(|n| repo.find_reference(n).ok())
            .and_then(|r| r.target())
    } else {
        None
    };

    let mut remote_obj =
        repo.find_remote(&remote_name)
            .map_err(|_| BackendError::RemoteNotFound {
                name: remote_name.clone(),
            })?;

    let refspec_prefix = if opts.force_with_lease { "+" } else { "" };
    let refspec = format!("{refspec_prefix}{branch_full}:{remote_ref}");

    // Lease violations surface as a typed error, but they fire from inside
    // git2's negotiation callback — capture the offending ref name there
    // and read it back after `push()` returns.
    let lease_violation: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let mut callbacks = build_credentials_callbacks();
    if opts.force_with_lease {
        let lease_violation = Arc::clone(&lease_violation);
        callbacks.push_negotiation(move |updates: &[git2::PushUpdate<'_>]| {
            for update in updates {
                let dst = update.dst();
                let dst_name = update.dst_refname().unwrap_or("(unknown)").to_string();
                match lease_oid {
                    Some(expected) if dst.is_zero() || dst == expected => {}
                    Some(_) => {
                        *lease_violation.lock().unwrap() = Some(dst_name.clone());
                        return Err(git2::Error::from_str(&format!(
                            "force-with-lease: {dst_name} moved on the remote"
                        )));
                    }
                    None => {}
                }
            }
            Ok(())
        });
    }

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    if let Err(e) = remote_obj.push(&[&refspec], Some(&mut push_opts)) {
        if let Some(ref_name) = lease_violation.lock().unwrap().clone() {
            return Err(BackendError::LeaseStale { ref_name });
        }
        return Err(BackendError::PushFailed(e.to_string()));
    }

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
