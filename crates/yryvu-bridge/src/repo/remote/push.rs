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
/// The lease anchor is mandatory: with no remote-tracking ref there is
/// nothing to lease against, and the refspec is force-prefixed either way,
/// so the push is refused rather than allowed to degrade into a bare
/// `--force`. See [`PushOptions::force_with_lease`] for why yryvu never
/// surfaces an unleased force.
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

    // Capture the remote tip OID we *expect* to overwrite — the lease
    // anchor. Without one there is no lease to honour, and since the
    // refspec below is force-prefixed, continuing would clobber whatever
    // the remote holds. A missing tracking ref does NOT mean the remote
    // branch is absent: it only means we have never seen it. Refuse
    // instead, so `force_with_lease` can never degrade into a bare force.
    let lease_oid = if opts.force_with_lease {
        let anchor = tracking_ref_full
            .as_deref()
            .and_then(|n| repo.find_reference(n).ok())
            .and_then(|r| r.target());
        Some(anchor.ok_or_else(|| {
            BackendError::Git(anyhow::anyhow!(
                "force-with-lease needs a remote-tracking ref for '{branch_shorthand}' to lease \
                 against, and none exists. Fetch the branch first so there is a known remote tip \
                 to compare — force-pushing without one would overwrite work you have never seen."
            ))
        })?)
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
                // `src` is what the remote currently has, `dst` is the local
                // OID we are about to push (libgit2 `push.c::add_update`
                // copies `spec->roid` into src and `spec->loid` into dst).
                // The lease compares against the remote's current tip, so it
                // must read `src` — reading `dst` compares our new tip to the
                // tracking ref and rejects every real force-push.
                let remote_has = update.src();
                let dst_name = update.dst_refname().unwrap_or("(unknown)").to_string();
                match lease_oid {
                    Some(expected) if remote_has == expected => {}
                    // Covers a zero `src` too: we hold a lease on a tip the
                    // remote no longer has, so the ref was deleted or
                    // replaced behind our back. That is a stale lease, not a
                    // free pass.
                    Some(_) => {
                        *lease_violation.lock().unwrap() = Some(dst_name.clone());
                        return Err(git2::Error::from_str(&format!(
                            "force-with-lease: {dst_name} moved on the remote"
                        )));
                    }
                    // Unreachable: a missing anchor is refused before we get
                    // here, so force-with-lease is never lease-less.
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
pub fn delete_tag_remote(repo_path: &Path, remote: &str, name: &str) -> Result<(), BackendError> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(cwd: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn out(cwd: &Path, args: &[&str]) -> String {
        String::from_utf8(
            Command::new("git")
                .args(args)
                .current_dir(cwd)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string()
    }

    fn identity(repo: &Path) {
        git(repo, &["config", "user.name", "t"]);
        git(repo, &["config", "user.email", "t@t"]);
    }

    /// A bare "origin" with one commit on `main`, plus a clone tracking it.
    fn origin_and_clone() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let origin = dir.path().join("origin.git");
        let work = dir.path().join("work");
        git(
            dir.path(),
            &[
                "init",
                "-q",
                "--bare",
                "-b",
                "main",
                origin.to_str().unwrap(),
            ],
        );

        let seed = dir.path().join("seed");
        std::fs::create_dir_all(&seed).unwrap();
        git(&seed, &["init", "-q", "-b", "main"]);
        identity(&seed);
        std::fs::write(seed.join("a.txt"), "base\n").unwrap();
        git(&seed, &["add", "."]);
        git(&seed, &["commit", "-qm", "base"]);
        git(
            &seed,
            &["remote", "add", "origin", origin.to_str().unwrap()],
        );
        git(&seed, &["push", "-q", "origin", "main"]);

        git(
            dir.path(),
            &[
                "clone",
                "-q",
                origin.to_str().unwrap(),
                work.to_str().unwrap(),
            ],
        );
        identity(&work);
        (dir, origin, work)
    }

    /// The lease is intact — nobody touched the remote. A force-with-lease
    /// push after a local rewrite must succeed.
    #[test]
    fn lease_allows_push_when_remote_has_not_moved() {
        let (_d, origin, work) = origin_and_clone();

        // Local history rewrite, the canonical force-with-lease case.
        std::fs::write(work.join("a.txt"), "amended\n").unwrap();
        git(&work, &["add", "."]);
        git(&work, &["commit", "-q", "--amend", "-m", "base amended"]);
        let local_tip = out(&work, &["rev-parse", "HEAD"]);

        push_current_branch(
            &work,
            PushOptions {
                force_with_lease: true,
            },
        )
        .expect("lease is intact; push must succeed");

        assert_eq!(
            out(&origin, &["rev-parse", "refs/heads/main"]),
            local_tip,
            "remote did not receive the rewritten tip"
        );
    }

    /// Someone else pushed to the remote and we never fetched. The lease is
    /// stale and the push must be refused instead of clobbering their work.
    #[test]
    fn lease_refuses_when_remote_moved_behind_our_back() {
        let (_d, origin, work) = origin_and_clone();

        // A teammate pushes through another clone.
        let other = _d.path().join("other");
        git(
            _d.path(),
            &[
                "clone",
                "-q",
                origin.to_str().unwrap(),
                other.to_str().unwrap(),
            ],
        );
        identity(&other);
        std::fs::write(other.join("teammate.txt"), "their work\n").unwrap();
        git(&other, &["add", "."]);
        git(&other, &["commit", "-qm", "teammate work"]);
        git(&other, &["push", "-q", "origin", "main"]);
        let their_tip = out(&origin, &["rev-parse", "refs/heads/main"]);

        // We rewrite locally, still unaware. Our tracking ref is stale.
        std::fs::write(work.join("a.txt"), "mine\n").unwrap();
        git(&work, &["add", "."]);
        git(&work, &["commit", "-q", "--amend", "-m", "mine"]);

        let err = push_current_branch(
            &work,
            PushOptions {
                force_with_lease: true,
            },
        )
        .expect_err("remote moved; lease must refuse");
        println!("error: {err:?}");
        assert!(
            matches!(err, BackendError::LeaseStale { .. }),
            "expected LeaseStale, got {err:?}"
        );
        assert_eq!(
            out(&origin, &["rev-parse", "refs/heads/main"]),
            their_tip,
            "teammate's commit was destroyed"
        );
    }

    /// No upstream configured does NOT mean the remote branch is absent.
    /// Without a tracking ref there is no lease to honour, so a
    /// force-with-lease push must refuse rather than force blindly.
    #[test]
    fn lease_refuses_without_a_tracking_ref() {
        let (_d, origin, work) = origin_and_clone();

        // A teammate's branch exists on the remote.
        let other = _d.path().join("other2");
        git(
            _d.path(),
            &[
                "clone",
                "-q",
                origin.to_str().unwrap(),
                other.to_str().unwrap(),
            ],
        );
        identity(&other);
        git(&other, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(other.join("theirs.txt"), "their work\n").unwrap();
        git(&other, &["add", "."]);
        git(&other, &["commit", "-qm", "teammate feature work"]);
        git(&other, &["push", "-q", "origin", "feature"]);
        let their_tip = out(&origin, &["rev-parse", "refs/heads/feature"]);

        // We create a local `feature` with no tracking, unaware of theirs.
        git(&work, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(work.join("mine.txt"), "mine\n").unwrap();
        git(&work, &["add", "."]);
        git(&work, &["commit", "-qm", "my unrelated work"]);

        let res = push_current_branch(
            &work,
            PushOptions {
                force_with_lease: true,
            },
        );
        println!("result: {res:?}");
        println!(
            "origin/feature after: {}",
            out(&origin, &["rev-parse", "refs/heads/feature"])
        );
        assert!(
            res.is_err(),
            "no tracking ref means no lease; must not force-push"
        );
        assert_eq!(
            out(&origin, &["rev-parse", "refs/heads/feature"]),
            their_tip,
            "teammate's commits were destroyed by a lease-less force push"
        );
    }
}
