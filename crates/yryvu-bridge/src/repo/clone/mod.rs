// SPDX-License-Identifier: AGPL-3.0-or-later

//! Repository clone with progress + per-session cancel.
//!
//! BACKEND: git2 — gix has clone surface but lacks ergonomic
//! integration with the credential helpers we need (libsecret /
//! Credential Vault). Revisit when gix surfaces those.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use git2::build::{CheckoutBuilder, RepoBuilder};
use git2::{ErrorClass, ErrorCode, FetchOptions};

use crate::backend::BackendError;
use crate::repo::common::git2_err;
use crate::repo::remote::credentials::build_credentials_callbacks;

pub mod registry;

#[derive(Debug, Clone)]
pub struct CloneOptions {
    pub url: String,
    pub dest_path: PathBuf,
    pub branch: Option<String>,
    pub depth: Option<u32>,
    pub recurse_submodules: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub phase: ClonePhase,
    pub percent: u8,
    pub current: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClonePhase {
    Counting,
    Compressing,
    Receiving,
    Resolving,
    Checkout,
}

pub type ProgressEmit = Arc<dyn Fn(CloneProgress) + Send + Sync>;

const THROTTLE: Duration = Duration::from_millis(100);

pub fn clone_repository(
    opts: CloneOptions,
    cancel: Arc<AtomicBool>,
    on_progress: ProgressEmit,
) -> Result<PathBuf, BackendError> {
    if !is_plausible_url(&opts.url) {
        return Err(BackendError::CloneInvalidUrl { url: opts.url });
    }
    if dest_is_blocking(&opts.dest_path) {
        return Err(BackendError::CloneDestExists {
            path: opts.dest_path.display().to_string(),
        });
    }

    let mut callbacks = build_credentials_callbacks();
    let last_emit = Arc::new(Mutex::new(Instant::now() - THROTTLE));
    let xfer_cancel = cancel.clone();
    let xfer_emit = on_progress.clone();
    let xfer_last = last_emit.clone();
    callbacks.transfer_progress(move |p| {
        if xfer_cancel.load(Ordering::SeqCst) {
            return false;
        }
        let total = p.total_objects() as u32;
        let received = p.received_objects() as u32;
        let indexed_d = p.indexed_deltas() as u32;
        let total_d = p.total_deltas() as u32;

        let (phase, current, total) = if total_d > 0 && indexed_d > 0 {
            (ClonePhase::Resolving, indexed_d, total_d)
        } else {
            (ClonePhase::Receiving, received, total)
        };
        emit_throttled(&xfer_last, &xfer_emit, phase, current, total);
        true
    });

    let mut fetch_opts = FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);
    if let Some(d) = opts.depth {
        fetch_opts.depth(d as i32);
    }

    let mut checkout = CheckoutBuilder::new();
    let chk_emit = on_progress.clone();
    let chk_last = last_emit.clone();
    checkout.progress(move |_path, current, total| {
        let cur = current as u32;
        let tot = total as u32;
        emit_throttled(&chk_last, &chk_emit, ClonePhase::Checkout, cur, tot);
    });

    let mut builder = RepoBuilder::new();
    builder.fetch_options(fetch_opts).with_checkout(checkout);
    if let Some(branch) = opts.branch.as_deref() {
        builder.branch(branch);
    }

    let result = builder.clone(&opts.url, &opts.dest_path);

    match result {
        Ok(_) => {
            if opts.recurse_submodules {
                update_submodules(&opts.dest_path, cancel.clone())?;
            }
            Ok(opts.dest_path)
        }
        Err(e) => {
            let cancelled = cancel.load(Ordering::SeqCst);
            // Best-effort cleanup of the half-cloned dest.
            let _ = std::fs::remove_dir_all(&opts.dest_path);
            if cancelled {
                Err(BackendError::CloneCancelled)
            } else {
                Err(map_clone_error(e))
            }
        }
    }
}

fn emit_throttled(
    last: &Mutex<Instant>,
    emit: &ProgressEmit,
    phase: ClonePhase,
    current: u32,
    total: u32,
) {
    let now = Instant::now();
    let mut guard = last.lock().expect("clone progress throttle poisoned");
    let final_tick = total > 0 && current >= total;
    if !final_tick && now.duration_since(*guard) < THROTTLE {
        return;
    }
    *guard = now;
    drop(guard);
    let percent = if total == 0 {
        0
    } else {
        ((current as u64 * 100) / total as u64).min(100) as u8
    };
    emit(CloneProgress {
        phase,
        percent,
        current,
        total,
    });
}

fn update_submodules(dest: &Path, cancel: Arc<AtomicBool>) -> Result<(), BackendError> {
    let repo = git2::Repository::open(dest).map_err(git2_err)?;
    for mut sub in repo.submodules().map_err(git2_err)? {
        if cancel.load(Ordering::SeqCst) {
            return Err(BackendError::CloneCancelled);
        }
        sub.update(true, None).map_err(git2_err)?;
    }
    Ok(())
}

fn dest_is_blocking(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    if !path.is_dir() {
        return true;
    }
    std::fs::read_dir(path)
        .map(|mut it| it.next().is_some())
        .unwrap_or(false)
}

fn is_plausible_url(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Local filesystem path (absolute or relative).
    if trimmed.starts_with('/') || trimmed.starts_with("./") || trimmed.starts_with("../") {
        return true;
    }
    // HTTPS / HTTP / git / SSH (ssh://) — full URL forms.
    if trimmed.contains("://") {
        return true;
    }
    // SCP-style SSH: `user@host:path`.
    if let Some(at_idx) = trimmed.find('@') {
        if let Some(colon_idx) = trimmed[at_idx..].find(':') {
            return colon_idx > 0;
        }
    }
    false
}

fn map_clone_error(e: git2::Error) -> BackendError {
    if e.code() == ErrorCode::Auth || e.class() == ErrorClass::Http {
        return BackendError::CloneAuthFailed;
    }
    if e.class() == ErrorClass::Net || e.class() == ErrorClass::Ssh {
        return BackendError::CloneNetworkError {
            detail: e.message().to_string(),
        };
    }
    if e.code() == ErrorCode::Exists {
        return BackendError::CloneDestExists {
            path: "destination already exists".into(),
        };
    }
    BackendError::Git(anyhow::Error::new(e))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use super::*;

    fn make_bare_with_commit(path: &Path) {
        let repo = git2::Repository::init_bare(path).expect("init bare");
        let sig = git2::Signature::now("yryvu-test", "test@local").expect("sig");
        let tree_id = repo
            .treebuilder(None)
            .expect("treebuilder")
            .write()
            .expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        repo.commit(Some("HEAD"), &sig, &sig, "seed", &tree, &[])
            .expect("seed commit");
    }

    #[test]
    fn rejects_empty_url() {
        let cancel = Arc::new(AtomicBool::new(false));
        let emit: ProgressEmit = Arc::new(|_| {});
        let dest = tempfile::tempdir().unwrap();
        let opts = CloneOptions {
            url: "".into(),
            dest_path: dest.path().join("repo"),
            branch: None,
            depth: None,
            recurse_submodules: false,
        };
        let err = clone_repository(opts, cancel, emit).unwrap_err();
        assert!(
            matches!(err, BackendError::CloneInvalidUrl { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn rejects_non_url() {
        let cancel = Arc::new(AtomicBool::new(false));
        let emit: ProgressEmit = Arc::new(|_| {});
        let dest = tempfile::tempdir().unwrap();
        let opts = CloneOptions {
            url: "not-a-url".into(),
            dest_path: dest.path().join("repo"),
            branch: None,
            depth: None,
            recurse_submodules: false,
        };
        let err = clone_repository(opts, cancel, emit).unwrap_err();
        assert!(
            matches!(err, BackendError::CloneInvalidUrl { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn accepts_https_scp_and_local_url_shapes() {
        assert!(is_plausible_url("https://github.com/foo/bar.git"));
        assert!(is_plausible_url("git://example.com/x"));
        assert!(is_plausible_url("ssh://git@example.com/x"));
        assert!(is_plausible_url("git@github.com:foo/bar.git"));
        assert!(is_plausible_url("/tmp/source.git"));
        assert!(is_plausible_url("./relative.git"));
        assert!(is_plausible_url("../sibling.git"));
        assert!(!is_plausible_url(""));
        assert!(!is_plausible_url("just-text"));
        assert!(!is_plausible_url("@host"));
    }

    #[test]
    fn rejects_existing_non_empty_dest() {
        let cancel = Arc::new(AtomicBool::new(false));
        let emit: ProgressEmit = Arc::new(|_| {});
        let dest_root = tempfile::tempdir().unwrap();
        let dest = dest_root.path().join("repo");
        std::fs::create_dir(&dest).unwrap();
        std::fs::write(dest.join("hello.txt"), "hi").unwrap();
        let opts = CloneOptions {
            url: "https://example.com/x.git".into(),
            dest_path: dest.clone(),
            branch: None,
            depth: None,
            recurse_submodules: false,
        };
        let err = clone_repository(opts, cancel, emit).unwrap_err();
        assert!(
            matches!(err, BackendError::CloneDestExists { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn clones_from_local_bare_repo_with_progress_events() {
        let bare_root = tempfile::tempdir().unwrap();
        let bare_path = bare_root.path().join("source.git");
        make_bare_with_commit(&bare_path);

        let dest_root = tempfile::tempdir().unwrap();
        let dest_path = dest_root.path().join("clone");
        let cancel = Arc::new(AtomicBool::new(false));
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_for_emit = calls.clone();
        let emit: ProgressEmit = Arc::new(move |_p| {
            calls_for_emit.fetch_add(1, Ordering::SeqCst);
        });

        let opts = CloneOptions {
            url: bare_path.display().to_string(),
            dest_path: dest_path.clone(),
            branch: None,
            depth: None,
            recurse_submodules: false,
        };
        let result = clone_repository(opts, cancel, emit).unwrap();
        assert_eq!(result, dest_path);
        assert!(dest_path.join(".git").is_dir());
        assert!(
            calls.load(Ordering::SeqCst) >= 1,
            "progress emitter should fire at least once for a non-empty clone",
        );
    }

    #[test]
    fn cancels_mid_clone_and_cleans_up_dest() {
        let bare_root = tempfile::tempdir().unwrap();
        let bare_path = bare_root.path().join("source.git");
        make_bare_with_commit(&bare_path);

        let dest_root = tempfile::tempdir().unwrap();
        let dest_path = dest_root.path().join("clone");
        let cancel = Arc::new(AtomicBool::new(true));
        let emit: ProgressEmit = Arc::new(|_| {});

        // file:// forces libgit2's network-style clone (the indexer +
        // transfer_progress callback). Plain filesystem paths use the
        // hardlink fast path which bypasses transfer_progress, so the
        // cancel flag is never observed.
        let opts = CloneOptions {
            url: format!("file://{}", bare_path.display()),
            dest_path: dest_path.clone(),
            branch: None,
            depth: None,
            recurse_submodules: false,
        };
        let err = clone_repository(opts, cancel, emit).unwrap_err();
        assert!(matches!(err, BackendError::CloneCancelled), "got {err:?}");
        assert!(
            !dest_path.exists(),
            "partial dest should be cleaned up on cancel",
        );
    }
}
