// SPDX-License-Identifier: AGPL-3.0-or-later

//! HEAD reflog parser for `Smart Branch Visibility`.
//!
//! GitKraken's [`SmartBranchesService`] feeds [`resolveAllowedRefs`] with a
//! "base branch" derived from two passes over the HEAD reflog. This module
//! mirrors that behavior:
//!
//! - Pass A grep-filters reflog messages to `branch: Created from`,
//!   `branch: Reset to`, or `reset: moving to`. Any `reset: moving to`
//!   disqualifies the lookup (`None`); otherwise the newest base name wins.
//! - Pass B runs only when Pass A captured the literal `HEAD`. It walks the
//!   HEAD reflog for `checkout: moving from <X> to <branch_shorthand>` and
//!   returns the source of the *oldest* such checkout (the moment the branch
//!   was first established with HEAD as its base).
//!
//! Results are cached per `(repo_path, head_full_name)` and invalidated by
//! the `mtime` of `<gitdir>/logs/HEAD`. The cache is bounded with a small
//! LRU (default 32 entries) — GitKraken's equivalent leaks indefinitely.
//!
//! See `docs/research/gitkraken-graph/25-smart-branch-visibility.md`.
//!
//! Submodules:
//! - [`parser`] — pure-string Pass A / Pass B / shorthand helpers.
//! - [`cache`] — bounded LRU keyed on `(repo_path, head_full_name)`,
//!   invalidated by `mtime(logs/HEAD)`.

mod cache;
mod parser;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::repo::branches;

use cache::cache;
use parser::{parse_pass_a, parse_pass_b, shorthand_for_local_branch};

/// Resolve a raw base name (typically a shorthand like `main` or `feature/x`,
/// occasionally a full ref name) to a full ref preferring its upstream.
///
/// Mirrors GitKraken's `resolveBaseRef`: prefers the local branch's upstream
/// full name when configured; otherwise falls back to `refs/heads/<name>` if
/// the local branch exists. Returns `None` when the name resolves to nothing.
pub fn resolve_base_ref(repo: &gix::Repository, raw_name: &str) -> Option<String> {
    if raw_name.is_empty() {
        return None;
    }

    let short = if let Some(rest) = raw_name.strip_prefix("refs/remotes/") {
        return Some(format!("refs/remotes/{rest}"));
    } else {
        raw_name.strip_prefix("refs/heads/").unwrap_or(raw_name)
    };

    if let Ok(Some((upstream_short, _))) = branches::upstream_for(repo, short) {
        return Some(format!("refs/remotes/{upstream_short}"));
    }

    let local_full = format!("refs/heads/{short}");
    if repo.find_reference(local_full.as_str()).is_ok() {
        return Some(local_full);
    }

    None
}

/// Read the branch reflog for the active branch's base. Returns the resolved
/// full ref name (preferring upstream) or `None` when the reflog is missing,
/// disqualified by a `reset: moving to`, or has no `branch: Created from` /
/// `branch: Reset to` entries to anchor on.
///
/// Pass A walks `<gitdir>/logs/<head_full_name>` — the branch's own reflog.
/// Pass B (only entered when Pass A captured the literal `HEAD`) walks
/// `<gitdir>/logs/HEAD` instead. Result is cached keyed on
/// `(repo_path, head_full_name)` and invalidated by `mtime(logs/HEAD)`,
/// matching GitKraken's behavior.
pub fn read_branch_base_from_reflog(
    repo: &gix::Repository,
    head_full_name: &str,
) -> Option<String> {
    let git_dir = repo.git_dir().to_path_buf();
    let head_log_path = git_dir.join("logs").join("HEAD");
    let mtime = mtime_of(&head_log_path);
    let cache_key = (git_dir.clone(), head_full_name.to_string());

    if let Some(cached) = cache().get(&cache_key, mtime) {
        return cached;
    }

    let resolved = compute_branch_base(repo, head_full_name, &git_dir, &head_log_path);
    cache().put(cache_key, mtime, resolved.clone());
    resolved
}

fn compute_branch_base(
    repo: &gix::Repository,
    head_full_name: &str,
    git_dir: &Path,
    head_log_path: &Path,
) -> Option<String> {
    let branch_log_path = branch_reflog_path(git_dir, head_full_name);
    let branch_reflog = fs::read_to_string(&branch_log_path).ok()?;

    let pass_a = parse_pass_a(&branch_reflog)?;
    let raw_name = if pass_a == "HEAD" {
        let head_short = shorthand_for_local_branch(head_full_name);
        let head_reflog = fs::read_to_string(head_log_path).ok()?;
        parse_pass_b(&head_reflog, head_short)?
    } else {
        pass_a
    };

    resolve_base_ref(repo, &raw_name)
}

fn branch_reflog_path(git_dir: &Path, head_full_name: &str) -> PathBuf {
    let mut path = git_dir.join("logs");
    for segment in head_full_name.split('/') {
        path.push(segment);
    }
    path
}

fn mtime_of(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).ok().and_then(|m| m.modified().ok())
}
