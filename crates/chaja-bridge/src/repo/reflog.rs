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

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use crate::repo::branches;

const REFLOG_CACHE_CAP: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PassAOutcome<'a> {
    None,
    DisqualifiedByReset,
    Base(&'a str),
}

/// Pass A: scan the reflog text, top-to-bottom (oldest-first as written by Git).
/// Returns the most recent `branch: Created from <X>` or `branch: Reset to <X>`
/// capture, unless any `reset: moving to ` line is present anywhere — which
/// disqualifies the lookup.
fn parse_pass_a(reflog: &str) -> Option<String> {
    let mut newest_base: Option<String> = None;

    for line in reflog.lines() {
        let Some(msg) = reflog_message(line) else {
            continue;
        };
        match classify_pass_a(msg) {
            PassAOutcome::DisqualifiedByReset => return None,
            PassAOutcome::Base(name) => newest_base = Some(name.to_string()),
            PassAOutcome::None => {}
        }
    }

    newest_base
}

fn classify_pass_a(msg: &str) -> PassAOutcome<'_> {
    if msg.starts_with("reset: moving to ") {
        return PassAOutcome::DisqualifiedByReset;
    }
    if let Some(rest) = msg.strip_prefix("branch: Created from ") {
        return PassAOutcome::Base(rest);
    }
    if let Some(rest) = msg.strip_prefix("branch: Reset to ") {
        return PassAOutcome::Base(rest);
    }
    PassAOutcome::None
}

/// Pass B: walk the reflog and return the source side of the *oldest*
/// `checkout: moving from <X> to <head_shorthand>` line. `--walk-reflogs`
/// emits newest-first, so "oldest" is GitKraken's "last match" — the moment
/// the branch was first established with HEAD as its base.
fn parse_pass_b(reflog: &str, head_shorthand: &str) -> Option<String> {
    let suffix = format!(" to {head_shorthand}");
    for line in reflog.lines() {
        let Some(msg) = reflog_message(line) else {
            continue;
        };
        let Some(rest) = msg.strip_prefix("checkout: moving from ") else {
            continue;
        };
        if let Some(from) = rest.strip_suffix(suffix.as_str()) {
            return Some(from.to_string());
        }
    }
    None
}

/// Extract the message segment of a single reflog line (everything after the
/// tab that follows the metadata header). Returns `None` for malformed lines.
fn reflog_message(line: &str) -> Option<&str> {
    let tab_idx = line.find('\t')?;
    Some(&line[tab_idx + 1..])
}

/// Strip a `refs/heads/` prefix from a full ref name. Returns the input
/// unchanged if it does not look like a local branch full name.
fn shorthand_for_local_branch(full_name: &str) -> &str {
    full_name.strip_prefix("refs/heads/").unwrap_or(full_name)
}

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

#[derive(Debug)]
struct ReflogCache {
    entries: Mutex<Vec<CacheRow>>,
    cap: usize,
}

#[derive(Debug, Clone)]
struct CacheRow {
    key: (PathBuf, String),
    mtime: Option<SystemTime>,
    base: Option<String>,
}

impl ReflogCache {
    const fn new(cap: usize) -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            cap,
        }
    }

    fn get(&self, key: &(PathBuf, String), mtime: Option<SystemTime>) -> Option<Option<String>> {
        let mut entries = self.entries.lock().ok()?;
        let idx = entries.iter().position(|row| &row.key == key)?;
        if entries[idx].mtime != mtime {
            entries.remove(idx);
            return None;
        }
        let row = entries.remove(idx);
        let base = row.base.clone();
        entries.push(row);
        Some(base)
    }

    fn put(&self, key: (PathBuf, String), mtime: Option<SystemTime>, base: Option<String>) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        if let Some(idx) = entries.iter().position(|row| row.key == key) {
            entries.remove(idx);
        }
        if entries.len() >= self.cap {
            entries.remove(0);
        }
        entries.push(CacheRow { key, mtime, base });
    }

    #[cfg(test)]
    fn clear(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
    }
}

fn cache() -> &'static ReflogCache {
    static CACHE: OnceLock<ReflogCache> = OnceLock::new();
    CACHE.get_or_init(|| ReflogCache::new(REFLOG_CACHE_CAP))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(oid_old: &str, oid_new: &str, msg: &str) -> String {
        format!("{oid_old} {oid_new} Some User <user@example.com> 1700000000 +0000\t{msg}\n")
    }

    #[test]
    fn pass_a_returns_newest_base() {
        let reflog = format!(
            "{}{}{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "branch: Created from main"
            ),
            line(
                "a".repeat(40).as_str(),
                "b".repeat(40).as_str(),
                "commit: tweak"
            ),
            line(
                "b".repeat(40).as_str(),
                "c".repeat(40).as_str(),
                "branch: Reset to develop"
            ),
        );
        assert_eq!(parse_pass_a(&reflog), Some("develop".to_string()));
    }

    #[test]
    fn pass_a_disqualified_by_reset_moving_to() {
        let reflog = format!(
            "{}{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "branch: Created from main"
            ),
            line(
                "a".repeat(40).as_str(),
                "b".repeat(40).as_str(),
                "reset: moving to abc1234"
            ),
        );
        assert_eq!(parse_pass_a(&reflog), None);
    }

    #[test]
    fn pass_a_returns_none_for_unrelated_messages() {
        let reflog = format!(
            "{}{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "commit: initial"
            ),
            line(
                "a".repeat(40).as_str(),
                "b".repeat(40).as_str(),
                "commit (amend): tweak"
            ),
        );
        assert_eq!(parse_pass_a(&reflog), None);
    }

    #[test]
    fn pass_a_returns_none_for_empty_reflog() {
        assert_eq!(parse_pass_a(""), None);
    }

    #[test]
    fn pass_a_skips_malformed_lines() {
        let reflog = format!(
            "no-tab-here\n{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "branch: Created from feature/x"
            ),
        );
        assert_eq!(parse_pass_a(&reflog), Some("feature/x".to_string()));
    }

    #[test]
    fn pass_a_handles_branch_name_with_slashes() {
        let reflog = line(
            "0".repeat(40).as_str(),
            "a".repeat(40).as_str(),
            "branch: Created from origin/release/1.0",
        );
        assert_eq!(
            parse_pass_a(&reflog),
            Some("origin/release/1.0".to_string())
        );
    }

    #[test]
    fn pass_b_returns_oldest_checkout_to_target() {
        let reflog = format!(
            "{}{}{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "checkout: moving from main to feature/x"
            ),
            line(
                "a".repeat(40).as_str(),
                "b".repeat(40).as_str(),
                "checkout: moving from feature/x to develop"
            ),
            line(
                "b".repeat(40).as_str(),
                "c".repeat(40).as_str(),
                "checkout: moving from develop to feature/x"
            ),
        );
        assert_eq!(parse_pass_b(&reflog, "feature/x"), Some("main".to_string()));
    }

    #[test]
    fn pass_b_returns_none_when_target_never_checked_out() {
        let reflog = line(
            "0".repeat(40).as_str(),
            "a".repeat(40).as_str(),
            "checkout: moving from main to develop",
        );
        assert_eq!(parse_pass_b(&reflog, "feature/x"), None);
    }

    #[test]
    fn pass_b_distinguishes_substring_target() {
        let reflog = format!(
            "{}{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "checkout: moving from main to feature/x-2"
            ),
            line(
                "a".repeat(40).as_str(),
                "b".repeat(40).as_str(),
                "checkout: moving from main to feature/x"
            ),
        );
        assert_eq!(parse_pass_b(&reflog, "feature/x"), Some("main".to_string()));
    }

    #[test]
    fn shorthand_strips_heads_prefix() {
        assert_eq!(shorthand_for_local_branch("refs/heads/main"), "main");
        assert_eq!(
            shorthand_for_local_branch("refs/heads/feature/x"),
            "feature/x"
        );
        assert_eq!(shorthand_for_local_branch("HEAD"), "HEAD");
        assert_eq!(
            shorthand_for_local_branch("refs/remotes/origin/main"),
            "refs/remotes/origin/main"
        );
    }

    #[test]
    fn cache_lru_evicts_oldest_when_full() {
        let cache = ReflogCache::new(2);
        let key_a: (PathBuf, String) = (PathBuf::from("/a"), "refs/heads/a".into());
        let key_b: (PathBuf, String) = (PathBuf::from("/b"), "refs/heads/b".into());
        let key_c: (PathBuf, String) = (PathBuf::from("/c"), "refs/heads/c".into());

        cache.put(key_a.clone(), None, Some("base_a".into()));
        cache.put(key_b.clone(), None, Some("base_b".into()));
        cache.put(key_c.clone(), None, Some("base_c".into()));

        assert!(cache.get(&key_a, None).is_none(), "oldest evicted");
        assert_eq!(cache.get(&key_b, None), Some(Some("base_b".into())));
        assert_eq!(cache.get(&key_c, None), Some(Some("base_c".into())));
    }

    #[test]
    fn cache_promotes_on_hit() {
        let cache = ReflogCache::new(2);
        let key_a: (PathBuf, String) = (PathBuf::from("/a"), "refs/heads/a".into());
        let key_b: (PathBuf, String) = (PathBuf::from("/b"), "refs/heads/b".into());
        let key_c: (PathBuf, String) = (PathBuf::from("/c"), "refs/heads/c".into());

        cache.put(key_a.clone(), None, Some("base_a".into()));
        cache.put(key_b.clone(), None, Some("base_b".into()));
        cache.get(&key_a, None);
        cache.put(key_c.clone(), None, Some("base_c".into()));

        assert_eq!(cache.get(&key_a, None), Some(Some("base_a".into())));
        assert!(
            cache.get(&key_b, None).is_none(),
            "B was LRU and got evicted"
        );
        cache.clear();
    }

    #[test]
    fn cache_invalidates_on_mtime_change() {
        let cache = ReflogCache::new(2);
        let key: (PathBuf, String) = (PathBuf::from("/a"), "refs/heads/a".into());
        let t0 = SystemTime::UNIX_EPOCH;
        let t1 = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1);

        cache.put(key.clone(), Some(t0), Some("old".into()));
        assert!(cache.get(&key, Some(t1)).is_none());
        cache.put(key.clone(), Some(t1), Some("new".into()));
        assert_eq!(cache.get(&key, Some(t1)), Some(Some("new".into())));
    }
}
