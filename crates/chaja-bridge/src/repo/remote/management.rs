// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::BackendError;
use crate::repo::common::{git2_err, open_git2, open_repo};
use crate::repo::hosting::remote_url;

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

/// Enumerate every configured remote name (e.g. `origin`, `upstream`).
/// Frontend uses this to decide whether the tag context menu's
/// `Push to remote` and `Delete from remote` actions need a remote-picker
/// dialog (>1 remote) or can fire silently (==1 remote).
pub fn list_remotes(repo_path: &Path) -> Result<Vec<String>, BackendError> {
    let repo = open_git2(repo_path)?;
    let names = repo.remotes().map_err(git2_err)?;
    Ok(names
        .iter()
        .filter_map(|s| s.map(String::from))
        .collect())
}

/// Validate a remote name client-side before calling git2 — git2 rejects
/// invalid names but the surfaced error is opaque (`config value 'remote.X'
/// was not found`). chajá's UI prefers a typed `InvalidRemoteName` so the
/// dialog can highlight the input field directly.
fn is_valid_remote_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(|c: char| {
            c.is_whitespace() || c == '/' || c == '\\' || c == ':' || c.is_control()
        })
}

/// Register a new remote pointing at `url`. Powers the `Add remote…`
/// action on the REMOTE-header context menu (#227). Validates the name
/// shape locally before delegating to git2 so the dialog can surface a
/// typed error against the field.
pub fn add_remote(repo_path: &Path, name: &str, url: &str) -> Result<(), BackendError> {
    if !is_valid_remote_name(name) {
        return Err(BackendError::InvalidRemoteName {
            name: name.to_string(),
        });
    }
    let repo = open_git2(repo_path)?;
    if repo.find_remote(name).is_ok() {
        return Err(BackendError::RemoteExists {
            name: name.to_string(),
        });
    }
    repo.remote(name, url).map_err(git2_err)?;
    Ok(())
}

/// Remove a configured remote. Drops the remote entry from the config
/// AND the local remote-tracking refs under `refs/remotes/<name>/*` so
/// the sidebar reflects the removal without a separate fetch cycle.
/// Powers the `Remove remote…` action on the REMOTE-header context menu.
pub fn remove_remote(repo_path: &Path, name: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    if repo.find_remote(name).is_err() {
        return Err(BackendError::RemoteNotFound {
            name: name.to_string(),
        });
    }
    repo.remote_delete(name).map_err(git2_err)?;
    Ok(())
}

/// Update the fetch URL for an existing remote. Powers the `Edit
/// remote…` action on the REMOTE-header context menu. Push URL is left
/// untouched — chajá doesn't expose split URLs in the dialog yet, and
/// git's default behaviour (push URL falls back to fetch URL when unset)
/// stays correct after the edit.
pub fn set_remote_url(repo_path: &Path, name: &str, url: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    if repo.find_remote(name).is_err() {
        return Err(BackendError::RemoteNotFound {
            name: name.to_string(),
        });
    }
    repo.remote_set_url(name, url).map_err(git2_err)?;
    Ok(())
}
