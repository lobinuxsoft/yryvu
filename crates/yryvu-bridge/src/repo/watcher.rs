// SPDX-License-Identifier: AGPL-3.0-or-later

//! Filesystem watcher for the *active* repository. Mirrors
//! [`crate::themes::watcher`] (notify + notify-debouncer-full) but targets a
//! repo working tree and emits **granular** events so the frontend refetches
//! only the affected slice instead of everything:
//!
//! - `.git/HEAD`, `refs/**`, `packed-refs`, `ORIG_HEAD`, `MERGE_HEAD`
//!   → [`REFS_CHANGED_EVENT`]     (commit graph + branch list)
//! - `.git/index`                 → [`INDEX_CHANGED_EVENT`]   (staging)
//! - working-tree files           → [`WORKTREE_CHANGED_EVENT`] (WIP status)
//!
//! Working-tree events are filtered through the repo's `.gitignore`
//! (+ `.git/info/exclude`), so a `cargo build` writing thousands of files
//! under `target/` doesn't wake the UI — that filter is the whole point of
//! the watcher's performance story. `.git/` internal noise (`objects/`,
//! `logs/`, `*.lock`, `COMMIT_EDITMSG`, fsmonitor) is dropped: only ref and
//! index writes carry meaning for the UI.
//!
//! GitKraken does the same job with the native `nsfw` watcher (bundle dep
//! `nsfw`); we reuse the `notify` stack already vendored for themes rather
//! than pull a second watcher.
//!
//! Only one repo is watched at a time. Switching repos replaces the watcher
//! (dropping the previous debouncer tears its thread down); closing the last
//! repo clears it. State lives in a process-wide `LazyLock<Mutex<..>>`,
//! matching [`crate::repo::search`] and [`crate::integrations::oauth`].
//!
//! Known v1 limitations (tracked in the perf issue): recursive `notify`
//! watches every directory including ignored ones (events are filtered, but
//! inotify descriptors are still spent); linked-worktree `.git` gitfiles
//! aren't followed, so their ref/index writes land elsewhere and aren't seen.

use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{Config, PollWatcher, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer_opt, Debouncer, RecommendedCache};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tracing::{debug, info, warn};

/// Longer than the themes watcher's 200 ms: a single `git` operation writes
/// many files (index, refs, logs) in a burst, and we want them to collapse
/// into one refresh rather than a stutter of partial ones.
const DEBOUNCE_MS: u64 = 400;

/// Poll interval used on filesystems where inotify is unreliable (see
/// [`fs_is_inotify_unreliable`]). The poll watcher stat-diffs snapshots
/// rather than subscribing to kernel events, so it never fires on reads —
/// the cost is up to this much latency plus a periodic stat walk.
const POLL_INTERVAL_SECS: u64 = 3;

/// Emitted when refs moved (HEAD / branches / tags / stash) — graph + branches.
pub const REFS_CHANGED_EVENT: &str = "repo-refs-changed";
/// Emitted when the staging index changed — WIP staged/unstaged split.
pub const INDEX_CHANGED_EVENT: &str = "repo-index-changed";
/// Emitted when non-ignored working-tree files changed — WIP status.
pub const WORKTREE_CHANGED_EVENT: &str = "repo-worktree-changed";

#[derive(Debug, Error)]
pub enum RepoWatcherError {
    #[error("repository path `{0}` does not exist")]
    Missing(String),
    #[error("notify watcher initialization failed")]
    Init(#[from] notify::Error),
}

/// RAII handle wrapping the running debouncer. Dropping it stops the watcher.
/// The backend differs by filesystem: inotify on ones that support it,
/// polling on FUSE/network mounts where inotify reports phantom events.
pub struct RepoWatcher {
    _handle: WatcherHandle,
}

enum WatcherHandle {
    Inotify(Debouncer<RecommendedWatcher, RecommendedCache>),
    Poll(Debouncer<PollWatcher, RecommendedCache>),
}

impl WatcherHandle {
    fn watch(&mut self, path: &Path, mode: RecursiveMode) -> notify::Result<()> {
        match self {
            WatcherHandle::Inotify(d) => d.watch(path, mode),
            WatcherHandle::Poll(d) => d.watch(path, mode),
        }
    }
}

/// The single active-repo watcher, if any.
static ACTIVE: LazyLock<Mutex<Option<RepoWatcher>>> = LazyLock::new(|| Mutex::new(None));

/// Which UI slices a batch of filesystem events touched.
#[derive(Default, Clone, Copy)]
struct Touched {
    refs: bool,
    index: bool,
    worktree: bool,
}

impl Touched {
    fn any(&self) -> bool {
        self.refs || self.index || self.worktree
    }

    fn all(&self) -> bool {
        self.refs && self.index && self.worktree
    }

    fn merge(&mut self, other: Touched) {
        self.refs |= other.refs;
        self.index |= other.index;
        self.worktree |= other.worktree;
    }
}

/// Start (or restart) watching `repo_path`. Replaces any previous watcher.
pub fn watch(app: AppHandle, repo_path: &Path) -> Result<(), RepoWatcherError> {
    if !repo_path.exists() {
        return Err(RepoWatcherError::Missing(repo_path.display().to_string()));
    }
    let watcher = start(app, repo_path)?;
    let mut slot = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    *slot = Some(watcher); // drops the previous debouncer, ending its thread
    Ok(())
}

/// Stop watching. No-op if nothing is being watched.
pub fn unwatch() {
    let mut slot = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    *slot = None;
}

fn start(app: AppHandle, repo_path: &Path) -> Result<RepoWatcher, RepoWatcherError> {
    let root = repo_path.to_path_buf();
    let git_dir = root.join(".git");
    let gitignore = Arc::new(Mutex::new(build_gitignore(&root)));
    let app = Arc::new(app);
    let root_for_handler = root.clone();

    // The same debounced handler drives both backends — only the watcher and
    // its config differ. Built once and moved into whichever branch runs
    // (mutually exclusive, so the borrow checker allows the shared move).
    let handler = move |result: notify_debouncer_full::DebounceEventResult| match result {
        Ok(events) if !events.is_empty() => {
            // A `.gitignore` edit changes what counts as noise — rebuild
            // the matcher before classifying this same batch.
            let ignore_changed = events
                .iter()
                .flat_map(|e| e.paths.iter())
                .any(|p| p.file_name().and_then(|n| n.to_str()) == Some(".gitignore"));
            if ignore_changed {
                if let Ok(mut g) = gitignore.lock() {
                    *g = build_gitignore(&root_for_handler);
                }
            }

            let touched = {
                let gi = gitignore.lock().unwrap_or_else(|e| e.into_inner());
                let mut agg = Touched::default();
                for path in events.iter().flat_map(|e| e.paths.iter()) {
                    agg.merge(classify(path, &git_dir, &gi));
                    if agg.all() {
                        break;
                    }
                }
                agg
            };

            if touched.any() {
                debug!(
                    refs = touched.refs,
                    index = touched.index,
                    worktree = touched.worktree,
                    "repo changed, emitting granular events"
                );
                emit(&app, touched);
            }
        }
        Ok(_) => {}
        Err(errors) => warn!(?errors, "repo watcher reported errors"),
    };

    let timeout = Duration::from_millis(DEBOUNCE_MS);
    let (mut handle, watch_root) = if fs_is_inotify_unreliable(&root) {
        info!(
            path = %root.display(),
            "repo is on a FUSE/network filesystem; using poll watcher scoped to \
             .git (inotify reports phantom events there and would storm the UI; \
             a full-tree poll is too slow on large working trees)"
        );
        let config = Config::default().with_poll_interval(Duration::from_secs(POLL_INTERVAL_SECS));
        let handle = WatcherHandle::Poll(new_debouncer_opt::<_, PollWatcher, _>(
            timeout,
            None,
            handler,
            RecommendedCache::new(),
            config,
        )?);
        // Poll only `.git` here: it catches commits, checkouts, branch moves and
        // staging (the high-value refresh triggers) cheaply. Stat-polling a huge
        // working tree every few seconds is too slow to be useful, so on these
        // filesystems unstaged edits made outside yryvu don't auto-refresh WIP.
        (handle, root.join(".git"))
    } else {
        let handle = WatcherHandle::Inotify(new_debouncer_opt::<_, RecommendedWatcher, _>(
            timeout,
            None,
            handler,
            RecommendedCache::new(),
            Config::default(),
        )?);
        (handle, root.clone())
    };

    handle.watch(&watch_root, RecursiveMode::Recursive)?;
    Ok(RepoWatcher { _handle: handle })
}

/// True when `path` sits on a filesystem whose inotify support is unreliable:
/// FUSE/fuseblk (ntfs-3g & friends report reads as writes — a read → refresh →
/// read feedback storm) and network mounts (miss remote changes). On those we
/// fall back to polling. Best-effort: on any parse failure we assume the
/// filesystem is fine and keep inotify.
fn fs_is_inotify_unreliable(path: &Path) -> bool {
    let canon = match std::fs::canonicalize(path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let mountinfo = match std::fs::read_to_string("/proc/self/mountinfo") {
        Ok(m) => m,
        Err(_) => return false,
    };
    match mount_fstype_for(&mountinfo, &canon) {
        Some(fstype) => fstype_is_unreliable(&fstype),
        None => false,
    }
}

/// Resolve the fstype of the mount that contains `canon` by longest matching
/// mount point in `/proc/self/mountinfo` content. Each line is
/// `… <mount-point> … - <fstype> <source> …`; we take the pre-`- ` 5th field
/// as the mount point and the first post-`- ` field as the fstype.
fn mount_fstype_for(mountinfo: &str, canon: &Path) -> Option<String> {
    let mut best: Option<(usize, String)> = None;
    for line in mountinfo.lines() {
        let (pre, post) = match line.split_once(" - ") {
            Some(v) => v,
            None => continue,
        };
        let mount_point = match pre.split(' ').nth(4) {
            Some(mp) => mp,
            None => continue,
        };
        let fstype = match post.split(' ').next() {
            Some(f) => f,
            None => continue,
        };
        if canon.starts_with(mount_point)
            && best.as_ref().is_none_or(|(l, _)| mount_point.len() > *l)
        {
            best = Some((mount_point.len(), fstype.to_string()));
        }
    }
    best.map(|(_, fstype)| fstype)
}

fn fstype_is_unreliable(fstype: &str) -> bool {
    fstype.starts_with("fuse")
        || matches!(
            fstype,
            "ntfs" | "nfs" | "nfs4" | "cifs" | "smb3" | "smbfs" | "9p"
        )
}

fn emit(app: &AppHandle, touched: Touched) {
    let send = |event: &'static str| {
        if let Err(e) = app.emit(event, ()) {
            warn!("failed to emit {event}: {e}");
        }
    };
    if touched.refs {
        send(REFS_CHANGED_EVENT);
    }
    if touched.index {
        send(INDEX_CHANGED_EVENT);
    }
    if touched.worktree {
        send(WORKTREE_CHANGED_EVENT);
    }
}

/// Classify one changed path into the UI slice(s) it affects.
///
/// Paths under `.git/` map to ref/index writes (ignoring object, log, lock
/// and message churn); everything else is a working-tree change unless it —
/// or a parent directory — is git-ignored.
fn classify(path: &Path, git_dir: &Path, gitignore: &Gitignore) -> Touched {
    let mut touched = Touched::default();

    if let Ok(rel) = path.strip_prefix(git_dir) {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        // `index.lock`, `*.lock`, `HEAD.lock` appear/vanish around every op.
        if name.ends_with(".lock") {
            return touched;
        }
        let rel = rel.to_string_lossy();
        if rel == "index" {
            touched.index = true;
        } else if rel == "HEAD"
            || rel == "ORIG_HEAD"
            || rel == "MERGE_HEAD"
            || rel == "FETCH_HEAD"
            || rel == "packed-refs"
            || rel.starts_with("refs")
        {
            touched.refs = true;
        }
        // objects/, logs/, COMMIT_EDITMSG, config, fsmonitor → intentionally dropped
        return touched;
    }

    // Working-tree path. `matched_path_or_any_parents` catches `target/foo`
    // via the `target/` rule even though `foo` itself has no rule.
    let is_dir = path.is_dir();
    if gitignore
        .matched_path_or_any_parents(path, is_dir)
        .is_ignore()
    {
        return touched;
    }
    touched.worktree = true;
    touched
}

/// Build a matcher from the repo's root `.gitignore` and `.git/info/exclude`.
/// Missing files are fine (their `add` error is ignored). Nested `.gitignore`
/// files deeper in the tree aren't loaded — the root rules cover the
/// build-output floods (`target/`, `node_modules/`, `dist/`) this filter
/// exists for; anything they miss simply costs one redundant refetch.
fn build_gitignore(root: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(root);
    let _ = builder.add(root.join(".gitignore"));
    let _ = builder.add(root.join(".git/info/exclude"));
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn gi_with(root: &Path, rules: &[&str]) -> Gitignore {
        let mut b = GitignoreBuilder::new(root);
        for r in rules {
            b.add_line(None, r).unwrap();
        }
        b.build().unwrap()
    }

    fn classify_at(root: &str, rel: &str, gitignore: &Gitignore) -> Touched {
        let root = PathBuf::from(root);
        let git_dir = root.join(".git");
        classify(&root.join(rel), &git_dir, gitignore)
    }

    #[test]
    fn head_and_refs_map_to_refs() {
        let root = "/repo";
        let gi = gi_with(Path::new(root), &[]);
        assert!(classify_at(root, ".git/HEAD", &gi).refs);
        assert!(classify_at(root, ".git/ORIG_HEAD", &gi).refs);
        assert!(classify_at(root, ".git/packed-refs", &gi).refs);
        assert!(classify_at(root, ".git/refs/heads/main", &gi).refs);
        assert!(classify_at(root, ".git/refs/tags/v1", &gi).refs);
    }

    #[test]
    fn index_maps_to_index_only() {
        let gi = gi_with(Path::new("/repo"), &[]);
        let t = classify_at("/repo", ".git/index", &gi);
        assert!(t.index && !t.refs && !t.worktree);
    }

    #[test]
    fn git_internal_noise_is_dropped() {
        let gi = gi_with(Path::new("/repo"), &[]);
        for rel in [
            ".git/index.lock",
            ".git/HEAD.lock",
            ".git/objects/ab/cdef",
            ".git/logs/HEAD",
            ".git/COMMIT_EDITMSG",
            ".git/config",
        ] {
            assert!(
                !classify_at("/repo", rel, &gi).any(),
                "{rel} should be dropped"
            );
        }
    }

    #[test]
    fn tracked_worktree_file_maps_to_worktree() {
        let gi = gi_with(Path::new("/repo"), &["target/"]);
        let t = classify_at("/repo", "src/main.rs", &gi);
        assert!(t.worktree && !t.refs && !t.index);
    }

    #[test]
    fn ignored_worktree_paths_are_dropped() {
        let gi = gi_with(Path::new("/repo"), &["target/", "node_modules/"]);
        assert!(!classify_at("/repo", "target/debug/app", &gi).any());
        assert!(!classify_at("/repo", "node_modules/x/index.js", &gi).any());
    }

    #[test]
    fn gitignore_file_itself_is_a_worktree_change() {
        let gi = gi_with(Path::new("/repo"), &["target/"]);
        assert!(classify_at("/repo", ".gitignore", &gi).worktree);
    }

    const MOUNTINFO: &str = "\
22 1 259:4 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw
30 22 0:50 / /home rw,relatime shared:2 - btrfs /dev/nvme0n1p3 rw
40 22 259:5 / /var/mnt/DATA rw,relatime shared:3 - fuseblk /dev/nvme0n1p4 rw
50 22 0:60 / /mnt/nas rw,relatime shared:4 - nfs4 10.0.0.1:/export rw";

    #[test]
    fn longest_mount_prefix_wins() {
        assert_eq!(
            mount_fstype_for(MOUNTINFO, Path::new("/var/mnt/DATA/Repos/x")).as_deref(),
            Some("fuseblk")
        );
        assert_eq!(
            mount_fstype_for(MOUNTINFO, Path::new("/home/user/code")).as_deref(),
            Some("btrfs")
        );
        assert_eq!(
            mount_fstype_for(MOUNTINFO, Path::new("/srv/thing")).as_deref(),
            Some("ext4")
        );
        assert_eq!(
            mount_fstype_for(MOUNTINFO, Path::new("/mnt/nas/repo")).as_deref(),
            Some("nfs4")
        );
    }

    #[test]
    fn unreliable_fstypes_classified() {
        for f in [
            "fuse",
            "fuseblk",
            "fuse.sshfs",
            "ntfs",
            "nfs",
            "nfs4",
            "cifs",
        ] {
            assert!(fstype_is_unreliable(f), "{f} should be unreliable");
        }
        for f in ["ext4", "btrfs", "xfs", "zfs", "tmpfs", "overlay"] {
            assert!(!fstype_is_unreliable(f), "{f} should be reliable");
        }
    }
}
