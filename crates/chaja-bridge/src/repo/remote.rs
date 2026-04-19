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
