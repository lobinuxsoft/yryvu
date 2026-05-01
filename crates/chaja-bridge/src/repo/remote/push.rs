// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::backend::{BackendError, PushOptions};
use crate::repo::common::{git2_err, open_git2};

use super::credentials::build_credentials_callbacks;

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

/// Push a local tag to a remote. Refspec is `refs/tags/<name>:refs/tags/<name>`
/// — annotated and lightweight tags use the same wire format.
///
/// Powers the `Push to remote` action on the tag context menu (#223).
/// The frontend resolves which remote(s) to push to (single-remote
/// repos go silently; multi-remote repos surface a picker dialog).
pub fn push_tag(repo_path: &Path, remote: &str, name: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let mut remote_obj = repo
        .find_remote(remote)
        .map_err(|_| BackendError::RemoteNotFound {
            name: remote.to_string(),
        })?;

    let refspec = format!("refs/tags/{name}:refs/tags/{name}");

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(build_credentials_callbacks());

    remote_obj
        .push(&[&refspec], Some(&mut push_opts))
        .map_err(|e| BackendError::PushFailed(e.to_string()))?;
    Ok(())
}

/// Delete a tag on a remote. Pushes a delete refspec
/// `:refs/tags/<name>` — the empty source tells the remote to drop the
/// ref. Doesn't touch the local tag (the local copy may still be
/// useful even after the remote deletion, e.g. for review workflows).
pub fn delete_tag_remote(
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

    let refspec = format!(":refs/tags/{name}");

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(build_credentials_callbacks());

    remote_obj
        .push(&[&refspec], Some(&mut push_opts))
        .map_err(|e| BackendError::PushFailed(e.to_string()))?;
    Ok(())
}
