// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use serde::Serialize;

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

    fetch_remote(&repo, &remote_name, git2::FetchPrune::Unspecified)?;

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

    fetch_remote(&repo, &remote_name, git2::FetchPrune::Unspecified)?;

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

/// One remote that didn't fetch, and why.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFetchFailure {
    pub remote: String,
    pub message: String,
}

/// Outcome of a fetch-all. The backend reports what happened and lets
/// the UI pick the severity — a run where two of three remotes fetched
/// is neither a success nor a failure, and collapsing it to either one
/// lies to the user.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FetchReport {
    pub succeeded: Vec<String>,
    pub failed: Vec<RemoteFetchFailure>,
}

impl FetchReport {
    pub fn attempted(&self) -> usize {
        self.succeeded.len() + self.failed.len()
    }
}

/// Fetch a single remote. `prune` is the caller's call: fetch-all
/// prunes, but the fetch inside a pull deliberately doesn't — an
/// in-flight pull must not delete tracking refs the user is browsing.
fn fetch_remote(
    repo: &git2::Repository,
    remote_name: &str,
    prune: git2::FetchPrune,
) -> Result<(), BackendError> {
    let mut remote_obj =
        repo.find_remote(remote_name)
            .map_err(|_| BackendError::RemoteNotFound {
                name: remote_name.to_string(),
            })?;

    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.prune(prune);
    fetch_opts.download_tags(git2::AutotagOption::None);
    fetch_opts.remote_callbacks(build_credentials_callbacks());

    // Empty refspec array → use the remote's configured fetch refspecs.
    remote_obj
        .fetch::<&str>(&[], Some(&mut fetch_opts), None)
        .map_err(|e| BackendError::FetchRemoteFailed {
            remote: remote_name.to_string(),
            message: e.to_string(),
        })
}

/// Fetch one remote, or every remote when `remote` is `None`.
///
/// **A failing remote never stops the others.** The loop used to
/// propagate with `?`, which meant an unreachable or unsupported remote
/// aborted the whole run — and since `repo.remotes()` returns names
/// sorted, whether your work got fetched depended on where the broken
/// remote landed in the alphabet (#509).
///
/// Naming a single remote still fails hard: one remote, one result,
/// nothing to aggregate.
pub fn fetch_prune(repo_path: &Path, remote: Option<&str>) -> Result<FetchReport, BackendError> {
    let repo = open_git2(repo_path)?;

    if let Some(name) = remote {
        fetch_remote(&repo, name, git2::FetchPrune::On)?;
        return Ok(FetchReport {
            succeeded: vec![name.to_string()],
            failed: Vec::new(),
        });
    }

    let mut report = FetchReport::default();
    let names: Vec<String> = repo
        .remotes()
        .map_err(git2_err)?
        .iter()
        .flatten()
        .map(|s| s.to_string())
        .collect();

    for name in names {
        match fetch_remote(&repo, &name, git2::FetchPrune::On) {
            Ok(()) => report.succeeded.push(name),
            Err(e) => report.failed.push(RemoteFetchFailure {
                remote: name,
                // The typed error already names the remote; the report
                // keeps them in separate fields so the caller can format
                // without re-parsing a sentence.
                message: match e {
                    BackendError::FetchRemoteFailed { message, .. } => message,
                    other => other.to_string(),
                },
            }),
        }
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .current_dir(dir)
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?} failed");
    }

    /// A source repo with one commit, plus a working repo whose remotes
    /// are set up by the caller. Everything is on disk — the local
    /// transport is enough to make a fetch genuinely succeed or fail
    /// without a network.
    fn origin_and_working() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let origin = dir.path().join("origin");
        std::fs::create_dir(&origin).unwrap();
        git(&origin, &["init", "-q", "-b", "main"]);
        git(&origin, &["config", "user.name", "t"]);
        git(&origin, &["config", "user.email", "t@t"]);
        std::fs::write(origin.join("a.txt"), "base\n").unwrap();
        git(&origin, &["add", "."]);
        git(&origin, &["commit", "-qm", "base"]);

        let work = dir.path().join("work");
        std::fs::create_dir(&work).unwrap();
        git(&work, &["init", "-q", "-b", "main"]);
        git(&work, &["config", "user.name", "t"]);
        git(&work, &["config", "user.email", "t@t"]);
        (dir, origin, work)
    }

    /// The #509 regression: a broken remote sorting *before* a good one
    /// used to abort the loop, so whether your work got fetched came
    /// down to the alphabet. `aaa-broken` is deliberately first.
    #[test]
    fn a_failing_remote_does_not_stop_the_ones_after_it() {
        let (_d, origin, work) = origin_and_working();
        git(
            &work,
            &["remote", "add", "aaa-broken", "/nonexistent/nope.git"],
        );
        git(
            &work,
            &["remote", "add", "zzz-good", origin.to_str().unwrap()],
        );

        let report = fetch_prune(&work, None).unwrap();

        assert_eq!(report.succeeded, vec!["zzz-good".to_string()]);
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].remote, "aaa-broken");
        assert_eq!(report.attempted(), 2);
        // The good remote's refs actually landed — the report isn't
        // just bookkeeping.
        assert!(work.join(".git/refs/remotes/zzz-good/main").exists());
    }

    #[test]
    fn every_remote_failing_is_reported_per_remote() {
        let (_d, _origin, work) = origin_and_working();
        git(&work, &["remote", "add", "one", "/nonexistent/a.git"]);
        git(&work, &["remote", "add", "two", "/nonexistent/b.git"]);

        let report = fetch_prune(&work, None).unwrap();

        assert!(report.succeeded.is_empty());
        let names: Vec<&str> = report.failed.iter().map(|f| f.remote.as_str()).collect();
        assert_eq!(names, vec!["one", "two"]);
        // Each failure carries its own reason rather than one shared
        // sentence with no remote in it.
        assert!(report.failed.iter().all(|f| !f.message.is_empty()));
    }

    #[test]
    fn no_remotes_is_an_empty_report_not_an_error() {
        let (_d, _origin, work) = origin_and_working();
        let report = fetch_prune(&work, None).unwrap();
        assert_eq!(report.attempted(), 0);
    }

    /// Naming one remote keeps failing hard: one remote, one result,
    /// nothing to aggregate.
    #[test]
    fn single_named_remote_still_errors_and_names_itself() {
        let (_d, _origin, work) = origin_and_working();
        git(&work, &["remote", "add", "broken", "/nonexistent/a.git"]);

        let err = fetch_prune(&work, Some("broken")).unwrap_err();
        match err {
            BackendError::FetchRemoteFailed { remote, .. } => assert_eq!(remote, "broken"),
            other => panic!("expected FetchRemoteFailed, got {other:?}"),
        }
    }

    #[test]
    fn single_named_remote_reports_itself_on_success() {
        let (_d, origin, work) = origin_and_working();
        git(&work, &["remote", "add", "up", origin.to_str().unwrap()]);

        let report = fetch_prune(&work, Some("up")).unwrap();
        assert_eq!(report.succeeded, vec!["up".to_string()]);
        assert!(report.failed.is_empty());
    }

    #[test]
    fn missing_remote_is_still_a_not_found_error() {
        let (_d, _origin, work) = origin_and_working();
        assert!(matches!(
            fetch_prune(&work, Some("ghost")),
            Err(BackendError::RemoteNotFound { .. })
        ));
    }

    #[test]
    fn report_serialises_camel_case() {
        let report = FetchReport {
            succeeded: vec!["a".into()],
            failed: vec![RemoteFetchFailure {
                remote: "b".into(),
                message: "boom".into(),
            }],
        };
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("\"succeeded\""));
        assert!(json.contains("\"remote\":\"b\""));
        assert!(!json.contains("remote_fetch"));
    }
}
