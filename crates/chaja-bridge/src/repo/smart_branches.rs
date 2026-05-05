// SPDX-License-Identifier: AGPL-3.0-or-later

//! Port of GitKraken's `SmartBranchesService.resolveAllowedRefs`.
//!
//! Computes the deterministic set of refs that should remain visible when
//! `Smart Branch Visibility` is enabled. The set is capped at five entries:
//!
//! 1. `HEAD`
//! 2. `upstream(HEAD)`
//! 3. **One** of (PR base wins over default branch when present):
//!    - PR base branch — chajá has no forge integration yet, so this is
//!      always [`None`] today.
//!    - Reflog-derived base — falls back to the PR slot when the PR is
//!      absent. See [`crate::repo::reflog`].
//!    - Default branch of the repo — used when neither PR nor reflog yield
//!      a base. Resolution cascade: `refs/remotes/<R>/HEAD` (origin or first
//!      remote) → caller-provided profile setting → `git config
//!      init.defaultBranch` → probe `main`/`master` → degenerate fallback
//!      to `refs/heads/main` even when missing.
//! 4. `upstream(...)` of the entry from (3) when it is a local branch.
//!    When (3) resolves to a remote ref, every local downstream of that
//!    remote is added instead.
//!
//! Only `refs/heads/...` and `refs/remotes/.../...` refs are emitted —
//! tags, annotated tags and stash refs are filtered out by construction
//! (matches GK `includeRef`).
//!
//! See `docs/research/gitkraken-graph/25-smart-branch-visibility.md`.

use std::collections::BTreeSet;
use std::path::Path;

use crate::backend::BackendError;
use crate::repo::branches;
use crate::repo::common::open_repo;
use crate::repo::reflog;

/// Resolve the repo's default branch full ref name following GitKraken's
/// cascade. Returns `Some(refs/heads/main)` even when no `main` exists
/// (degenerate fallback that mirrors GK).
pub fn default_branch_full_name(
    repo: &gix::Repository,
    profile_default: Option<&str>,
) -> Option<String> {
    if let Some(target) = remote_head_target(repo) {
        return Some(target);
    }

    if let Some(name) = profile_default {
        let full = format!("refs/heads/{name}");
        if repo.find_reference(full.as_str()).is_ok() {
            return Some(full);
        }
    }

    if let Some(name) = git_config_default_branch(repo) {
        let full = format!("refs/heads/{name}");
        if repo.find_reference(full.as_str()).is_ok() {
            return Some(full);
        }
    }

    let main = "refs/heads/main".to_string();
    if repo.find_reference(main.as_str()).is_ok() {
        return Some(main);
    }
    let master = "refs/heads/master".to_string();
    if repo.find_reference(master.as_str()).is_ok() {
        return Some(master);
    }

    Some(main)
}

fn remote_head_target(repo: &gix::Repository) -> Option<String> {
    if let Some(target) = read_remote_head_symref(repo, "origin") {
        return Some(target);
    }
    let names = repo.remote_names();
    for name in names.iter() {
        let n = name.to_string();
        if n == "origin" {
            continue;
        }
        if let Some(target) = read_remote_head_symref(repo, &n) {
            return Some(target);
        }
    }
    None
}

fn read_remote_head_symref(repo: &gix::Repository, remote_name: &str) -> Option<String> {
    let ref_name = format!("refs/remotes/{remote_name}/HEAD");
    let r = repo.find_reference(ref_name.as_str()).ok()?;
    match r.target() {
        gix::refs::TargetRef::Symbolic(name) => Some(name.as_bstr().to_string()),
        gix::refs::TargetRef::Object(_) => None,
    }
}

fn git_config_default_branch(repo: &gix::Repository) -> Option<String> {
    let snapshot = repo.config_snapshot();
    snapshot
        .string("init.defaultBranch")
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// Compute the allowed visible refs for `Smart Branch Visibility`.
///
/// Returns an alphabetically sorted [`Vec`] of full ref names. An empty
/// vector means the caller should *not* apply Smart Branches — typical
/// causes are detached HEAD, an unborn HEAD, or a repo that failed to
/// open. chajá deviates from GK here: GK silently no-ops, while we surface
/// the empty result so the frontend can clear `smartBranchesManaged`.
pub fn smart_visible_refs(
    repo_path: &Path,
    profile_default: Option<&str>,
) -> Result<Vec<String>, BackendError> {
    let repo = open_repo(repo_path)?;

    let Some(head_full_name) = repo
        .head_name()
        .ok()
        .flatten()
        .map(|n| n.as_bstr().to_string())
    else {
        return Ok(Vec::new());
    };

    if !is_local_branch_full_name(&head_full_name) {
        return Ok(Vec::new());
    }

    let mut set: BTreeSet<String> = BTreeSet::new();
    include_ref(&mut set, &repo, &head_full_name);
    include_upstream(&mut set, &repo, &head_full_name);

    let reflog_base = reflog::read_branch_base_from_reflog(&repo, &head_full_name)
        .filter(|name| name != &head_full_name);

    if let Some(base) = reflog_base {
        include_with_upstream(&mut set, &repo, &base);
        return Ok(set.into_iter().collect());
    }

    if let Some(default) = default_branch_full_name(&repo, profile_default) {
        if default != head_full_name {
            if default.starts_with("refs/remotes/") {
                include_ref(&mut set, &repo, &default);
                for downstream in downstreams_of_remote(&repo, &default) {
                    include_ref(&mut set, &repo, &downstream);
                }
            } else {
                include_with_upstream(&mut set, &repo, &default);
            }
        }
    }

    Ok(set.into_iter().collect())
}

fn include_ref(set: &mut BTreeSet<String>, repo: &gix::Repository, full_name: &str) {
    if !is_branch_or_remote(full_name) {
        return;
    }
    if repo.find_reference(full_name).is_err() {
        return;
    }
    set.insert(full_name.to_string());
}

fn include_upstream(set: &mut BTreeSet<String>, repo: &gix::Repository, full_name: &str) {
    let Some(short) = full_name.strip_prefix("refs/heads/") else {
        return;
    };
    if let Ok(Some((upstream_short, _))) = branches::upstream_for(repo, short) {
        let full = format!("refs/remotes/{upstream_short}");
        include_ref(set, repo, &full);
    }
}

fn include_with_upstream(set: &mut BTreeSet<String>, repo: &gix::Repository, full_name: &str) {
    if full_name.starts_with("refs/remotes/") {
        include_ref(set, repo, full_name);
        return;
    }
    include_ref(set, repo, full_name);
    include_upstream(set, repo, full_name);
}

fn downstreams_of_remote(repo: &gix::Repository, remote_full: &str) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(platform) = repo.references() else {
        return out;
    };
    let Ok(iter) = platform.local_branches() else {
        return out;
    };
    for r in iter.flatten() {
        let name = r.name().as_bstr().to_string();
        let Some(short) = name.strip_prefix("refs/heads/") else {
            continue;
        };
        let Ok(Some((upstream_short, _))) = branches::upstream_for(repo, short) else {
            continue;
        };
        let full = format!("refs/remotes/{upstream_short}");
        if full == remote_full {
            out.push(name);
        }
    }
    out
}

fn is_branch_or_remote(full_name: &str) -> bool {
    full_name.starts_with("refs/heads/") || full_name.starts_with("refs/remotes/")
}

fn is_local_branch_full_name(s: &str) -> bool {
    s.starts_with("refs/heads/")
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::process::Command;

    use super::*;

    fn run(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .expect("git command runs");
        assert!(status.success(), "git {args:?} failed in {dir:?}");
    }

    fn run_quiet(dir: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    fn init_repo(name: &str) -> tempfile::TempDir {
        let dir = tempfile::TempDir::with_prefix(name).expect("tempdir");
        run(dir.path(), &["init", "--initial-branch=main", "-q"]);
        run(dir.path(), &["config", "user.email", "test@chaja.local"]);
        run(dir.path(), &["config", "user.name", "test"]);
        run(dir.path(), &["commit", "--allow-empty", "-m", "init", "-q"]);
        dir
    }

    fn open(dir: &Path) -> gix::Repository {
        gix::open(dir).expect("gix open")
    }

    #[test]
    fn single_branch_repo_returns_only_head() {
        let repo = init_repo("chaja-smart-single");
        let refs = smart_visible_refs(repo.path(), None).expect("ok");
        assert_eq!(refs, vec!["refs/heads/main".to_string()]);
    }

    #[test]
    fn detached_head_returns_empty() {
        let repo = init_repo("chaja-smart-detached");
        run(repo.path(), &["commit", "--allow-empty", "-m", "two", "-q"]);
        let head_sha = String::from_utf8(
            Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(repo.path())
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        run(repo.path(), &["checkout", "--detach", &head_sha, "-q"]);
        let refs = smart_visible_refs(repo.path(), None).expect("ok");
        assert!(refs.is_empty(), "detached HEAD should produce empty set");
    }

    #[test]
    fn head_plus_default_branch_main() {
        let repo = init_repo("chaja-smart-default-main");
        run(repo.path(), &["checkout", "-b", "feature/x", "-q"]);
        let refs = smart_visible_refs(repo.path(), None).expect("ok");
        assert!(
            refs.contains(&"refs/heads/feature/x".to_string()),
            "{refs:?}"
        );
        assert!(refs.contains(&"refs/heads/main".to_string()), "{refs:?}");
    }

    #[test]
    fn reflog_base_wins_over_default_branch() {
        let repo = init_repo("chaja-smart-reflog");
        run(repo.path(), &["checkout", "-b", "trunk", "-q"]);
        run(
            repo.path(),
            &["commit", "--allow-empty", "-m", "trunk", "-q"],
        );
        run(repo.path(), &["checkout", "-b", "feature/y", "-q"]);
        let refs = smart_visible_refs(repo.path(), None).expect("ok");
        assert!(
            refs.contains(&"refs/heads/feature/y".to_string()),
            "{refs:?}"
        );
        assert!(
            refs.contains(&"refs/heads/trunk".to_string()),
            "expected reflog-derived base trunk, got {refs:?}"
        );
        assert!(
            !refs.contains(&"refs/heads/main".to_string()),
            "PR/reflog base should suppress default branch, got {refs:?}"
        );
    }

    #[test]
    fn profile_default_branch_used_when_remote_head_absent() {
        let repo = init_repo("chaja-smart-profile-default");
        run(repo.path(), &["branch", "trunk"]);
        run(repo.path(), &["checkout", "-b", "feature/z", "-q"]);
        let supports_d = run_quiet(repo.path(), &["reflog", "delete", "HEAD@{0}"]);
        if supports_d {
            run(repo.path(), &["reflog", "expire", "--expire=all", "--all"]);
        } else {
            std::fs::remove_file(repo.path().join(".git").join("logs").join("HEAD")).ok();
        }
        let refs = smart_visible_refs(repo.path(), Some("trunk")).expect("ok");
        assert!(
            refs.contains(&"refs/heads/feature/z".to_string()),
            "{refs:?}"
        );
        assert!(
            refs.contains(&"refs/heads/trunk".to_string()),
            "profile default branch should resolve, got {refs:?}"
        );
    }

    #[test]
    fn default_branch_resolves_to_main_when_present() {
        let repo = init_repo("chaja-smart-default-resolve");
        let gix = open(repo.path());
        let resolved = default_branch_full_name(&gix, None);
        assert_eq!(resolved, Some("refs/heads/main".to_string()));
    }

    #[test]
    fn default_branch_resolves_to_master_when_main_missing() {
        let dir = tempfile::TempDir::with_prefix("chaja-smart-master").expect("tempdir");
        run(dir.path(), &["init", "--initial-branch=master", "-q"]);
        run(dir.path(), &["config", "user.email", "test@chaja.local"]);
        run(dir.path(), &["config", "user.name", "test"]);
        run(dir.path(), &["commit", "--allow-empty", "-m", "init", "-q"]);
        let gix = open(dir.path());
        let resolved = default_branch_full_name(&gix, None);
        assert_eq!(resolved, Some("refs/heads/master".to_string()));
    }

    #[test]
    fn default_branch_degenerate_fallback_when_nothing_resolves() {
        let dir = tempfile::TempDir::with_prefix("chaja-smart-empty").expect("tempdir");
        run(dir.path(), &["init", "--initial-branch=trunk", "-q"]);
        let gix = open(dir.path());
        let resolved = default_branch_full_name(&gix, None);
        assert_eq!(
            resolved,
            Some("refs/heads/main".to_string()),
            "degenerate fallback should be main even though it doesn't exist"
        );
    }

    #[test]
    fn tags_never_appear_in_visible_set() {
        let repo = init_repo("chaja-smart-tags");
        run(repo.path(), &["tag", "v1.0"]);
        run(repo.path(), &["tag", "-a", "v2.0", "-m", "annotated"]);
        let refs = smart_visible_refs(repo.path(), None).expect("ok");
        for r in &refs {
            assert!(
                r.starts_with("refs/heads/") || r.starts_with("refs/remotes/"),
                "tag leaked into visible set: {r}"
            );
        }
    }
}
