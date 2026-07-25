// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::backend::BackendError;
use crate::repo::common::{git2_err, open_git2, open_repo};
use crate::repo::hosting::remote_url;

/// One configured remote, with its URLs resolved.
///
/// `push_url` is `None` when `remote.<name>.pushurl` is unset — the
/// common case, where git pushes to the fetch URL. Kept distinct from
/// `Some(url_equal_to_fetch)` because they are different states: the
/// former follows the fetch URL if it is later edited, the latter is
/// pinned and would silently keep pushing to the old host.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

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

/// Enumerate remotes with their fetch and push URLs. Backs the remote
/// rows in the sidebar (which show the URL GitKraken never surfaces
/// anywhere) and the edit dialog's initial state.
///
/// A remote with no fetch URL is possible (`git remote add --mirror=push`)
/// and is reported as `None` rather than skipped — hiding it from the
/// list would make it unmanageable from the UI.
pub fn list_remotes_detailed(repo_path: &Path) -> Result<Vec<RemoteInfo>, BackendError> {
    let repo = open_git2(repo_path)?;
    let names = repo.remotes().map_err(git2_err)?;
    let mut out = Vec::with_capacity(names.len());
    for name in names.iter().flatten() {
        let remote = repo.find_remote(name).map_err(git2_err)?;
        out.push(RemoteInfo {
            name: name.to_string(),
            fetch_url: remote.url().map(String::from),
            push_url: remote.pushurl().map(String::from),
        });
    }
    Ok(out)
}

/// Rename a remote, moving its tracking refs with it.
///
/// `git2::Repository::remote_rename` wraps `git_remote_rename`, which
/// renames the config section, rewrites the default fetch refspec, and
/// moves `refs/remotes/<old>/*` to `refs/remotes/<new>/*` in one call —
/// so no re-fetch is needed. (An earlier comment in the edit dialog
/// claimed libgit2 had no single-call rename and made the name field
/// immutable; it does, and this is it. Same upstream-first fix as #455
/// for branch rename.)
///
/// The returned strings are refspecs libgit2 could not rewrite because
/// they were customised by hand. They are not errors — the rename
/// succeeded — but the caller should surface them, since those refspecs
/// still point at the old name.
pub fn rename_remote(
    repo_path: &Path,
    old_name: &str,
    new_name: &str,
) -> Result<Vec<String>, BackendError> {
    if !is_valid_remote_name(new_name) {
        return Err(BackendError::InvalidRemoteName {
            name: new_name.to_string(),
        });
    }
    let repo = open_git2(repo_path)?;
    if repo.find_remote(old_name).is_err() {
        return Err(BackendError::RemoteNotFound {
            name: old_name.to_string(),
        });
    }
    // Renaming onto an existing remote would otherwise fail deep inside
    // libgit2 with a config-level message that names neither remote.
    if old_name != new_name && repo.find_remote(new_name).is_ok() {
        return Err(BackendError::RemoteExists {
            name: new_name.to_string(),
        });
    }
    let problems = repo.remote_rename(old_name, new_name).map_err(git2_err)?;
    Ok(problems.iter().flatten().map(String::from).collect())
}

/// Set or clear `remote.<name>.pushurl`.
///
/// `None` clears it, restoring git's default of pushing to the fetch
/// URL. GitKraken instead writes the fetch URL into `pushurl` when its
/// push field is left empty, which looks equivalent but pins the value:
/// editing the fetch URL afterwards leaves pushes going to the old host,
/// with nothing in the UI to explain why. Clearing is recoverable;
/// pinning is a trap.
pub fn set_remote_push_url(
    repo_path: &Path,
    name: &str,
    url: Option<&str>,
) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    if repo.find_remote(name).is_err() {
        return Err(BackendError::RemoteNotFound {
            name: name.to_string(),
        });
    }
    repo.remote_set_pushurl(name, url).map_err(git2_err)?;
    Ok(())
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
/// remote…` dialog. Push URL is left untouched here — it has its own
/// setter (`set_remote_push_url`), so an edit that only changes the
/// fetch URL cannot silently disturb a configured `pushurl`.
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .current_dir(repo)
            .args(args)
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {args:?} failed");
    }

    fn out(repo: &Path, args: &[&str]) -> String {
        String::from_utf8(
            Command::new("git")
                .current_dir(repo)
                .args(args)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string()
    }

    /// Repo with one commit and an `origin` remote. The remote URL is a
    /// bare path that need not exist — nothing here fetches.
    fn repo_with_origin() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_path_buf();
        git(&p, &["init", "-q", "-b", "main"]);
        git(&p, &["config", "user.name", "t"]);
        git(&p, &["config", "user.email", "t@t"]);
        std::fs::write(p.join("a.txt"), "base\n").unwrap();
        git(&p, &["add", "."]);
        git(&p, &["commit", "-qm", "base"]);
        git(
            &p,
            &["remote", "add", "origin", "https://example.test/a.git"],
        );
        (dir, p)
    }

    /// The whole reason the edit dialog kept the name immutable: the
    /// claim that libgit2 has no single-call rename. It does, and it
    /// carries the tracking refs across, so no re-fetch is needed.
    #[test]
    fn rename_moves_tracking_refs_and_config() {
        let (_d, p) = repo_with_origin();
        // A tracking ref that must survive under the new name.
        let head = out(&p, &["rev-parse", "HEAD"]);
        git(&p, &["update-ref", "refs/remotes/origin/main", &head]);

        let problems = rename_remote(&p, "origin", "upstream").unwrap();

        assert!(
            problems.is_empty(),
            "default refspec should rewrite cleanly"
        );
        assert_eq!(out(&p, &["remote"]), "upstream", "old name must be gone");
        assert_eq!(
            out(&p, &["rev-parse", "refs/remotes/upstream/main"]),
            head,
            "tracking ref must move with the remote"
        );
        assert_eq!(
            out(&p, &["config", "remote.upstream.url"]),
            "https://example.test/a.git"
        );
        assert_eq!(
            out(&p, &["config", "remote.upstream.fetch"]),
            "+refs/heads/*:refs/remotes/upstream/*",
            "fetch refspec must be rewritten to the new name"
        );
    }

    #[test]
    fn rename_onto_existing_remote_is_refused() {
        let (_d, p) = repo_with_origin();
        git(
            &p,
            &["remote", "add", "upstream", "https://example.test/b.git"],
        );

        let err = rename_remote(&p, "origin", "upstream").unwrap_err();

        assert!(matches!(err, BackendError::RemoteExists { .. }));
        // Both must survive the refusal untouched.
        assert_eq!(
            out(&p, &["config", "remote.origin.url"]),
            "https://example.test/a.git"
        );
        assert_eq!(
            out(&p, &["config", "remote.upstream.url"]),
            "https://example.test/b.git"
        );
    }

    #[test]
    fn rename_rejects_invalid_name() {
        let (_d, p) = repo_with_origin();
        let err = rename_remote(&p, "origin", "bad name").unwrap_err();
        assert!(matches!(err, BackendError::InvalidRemoteName { .. }));
        assert_eq!(out(&p, &["remote"]), "origin");
    }

    /// `None` clears the key outright. GitKraken writes the fetch URL
    /// into it instead, which pins pushes to whatever the fetch URL was
    /// at that moment — editing the fetch URL later silently keeps
    /// pushing to the old host.
    #[test]
    fn push_url_set_then_cleared_falls_back_to_fetch_url() {
        let (_d, p) = repo_with_origin();

        set_remote_push_url(&p, "origin", Some("https://example.test/push.git")).unwrap();
        let info = &list_remotes_detailed(&p).unwrap()[0];
        assert_eq!(
            info.push_url.as_deref(),
            Some("https://example.test/push.git")
        );

        set_remote_push_url(&p, "origin", None).unwrap();
        let info = &list_remotes_detailed(&p).unwrap()[0];
        assert_eq!(info.push_url, None, "cleared, not pinned to the fetch URL");
        assert_eq!(
            out(&p, &["config", "--get", "remote.origin.pushurl"]),
            "",
            "the key itself must be gone from config"
        );
    }

    #[test]
    fn detailed_listing_reports_urls() {
        let (_d, p) = repo_with_origin();
        git(&p, &["remote", "add", "fork", "https://example.test/f.git"]);

        let list = list_remotes_detailed(&p).unwrap();

        assert_eq!(list.len(), 2);
        let origin = list.iter().find(|r| r.name == "origin").unwrap();
        assert_eq!(
            origin.fetch_url.as_deref(),
            Some("https://example.test/a.git")
        );
        assert_eq!(origin.push_url, None);
    }

    #[test]
    fn rename_missing_remote_is_reported() {
        let (_d, p) = repo_with_origin();
        let err = rename_remote(&p, "nope", "other").unwrap_err();
        assert!(matches!(err, BackendError::RemoteNotFound { .. }));
    }
}
