// SPDX-License-Identifier: AGPL-3.0-or-later

//! Per-repo undo/redo operation log.
//!
//! Sub-PR 1 of issue #130: stores the trace of git operations chajá knows
//! how to invert, so a subsequent `undo` IPC can walk back through the
//! history and replay the inverse.
//!
//! # Why a sidecar
//!
//! GitKraken's bundle reads from `.git/logs/HEAD` (the ref reflog) and
//! caches a parallel stack in redux to avoid hitting disk every render. We
//! follow the same split, with two adjustments:
//!
//! 1. **Sidecar JSON instead of redux.** Chajá's frontend is reactive and
//!    queries the backend per repo refresh; an in-memory cache buys us
//!    nothing across app restarts. Disk-backed storage survives the user
//!    closing the app mid-session and re-opening to undo something.
//!
//! 2. **Persists past the reflog's GC window.** Git prunes the reflog
//!    after 90 days by default; an undo log driven solely by reflog reads
//!    silently drops history. The sidecar at `.git/chaja-undo.json`
//!    stores everything chajá needs (pre/post SHAs, op kind, stash
//!    indexes) without depending on the reflog being intact.
//!
//! The reflog is still tagged with `chaja:op=<kind>|...` messages on each
//! op so an external `git reflog` shows the same intent — useful for
//! humans and future cross-tool integration.
//!
//! # What's tracked
//!
//! Mirrors GK's set 1:1: commit (with parent), amend, checkout (branch +
//! commit), reset (soft/mixed/hard), cherry-pick, revert, merge, stash
//! push, stash pop. Branch CRUD, fetch, pull, push, and tag operations
//! are deliberately NOT tracked — GK skips them and the inverse for many
//! is either trivial (delete to recreate) or unsafe (push undo would need
//! force-push which is not a chajá-allowed operation).
//!
//! # What sub-PR 1 does NOT do
//!
//! Read the log back. Compute inverses. Expose `undo` / `redo` IPCs.
//! Wire the toolbar buttons. Bind keyboard shortcuts. Those are sub-PRs
//! 2 and 3 — this module is a pure write surface for now.

use std::cell::Cell;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::backend::ResetMode;

thread_local! {
    /// Set by [`with_record_skipped`] while an undo / redo is replaying a
    /// public op wrapper. The wrapper still runs the git work, but
    /// `record_op_best_effort` short-circuits — without this guard a
    /// `checkout_branch` called from inside `apply_inverse` would append
    /// a fresh log entry, which would (a) compete with the cursor walk
    /// the IPC layer just performed and (b) silently corrupt the redo
    /// path.
    ///
    /// Thread-local is sufficient because Tauri commands run on
    /// `spawn_blocking` worker threads — each command is single-threaded
    /// inside, and concurrent commands on different threads carry their
    /// own flag.
    static SKIP_RECORD: Cell<bool> = const { Cell::new(false) };
}

/// Run `f` with the undo-log writer suppressed. Used by
/// [`crate::repo::undo::apply_inverse`] and the (sub-PR 3) `apply_redo`
/// to call the existing public op wrappers without leaving phantom
/// entries in the log.
pub fn with_record_skipped<F, R>(f: F) -> R
where
    F: FnOnce() -> R,
{
    SKIP_RECORD.with(|c| c.set(true));
    let result = f();
    SKIP_RECORD.with(|c| c.set(false));
    result
}

/// On-disk location of the sidecar log, relative to the repo's `.git`
/// directory. Hidden by virtue of living inside `.git`, which standard
/// tooling already excludes from working-tree listings.
pub const UNDO_LOG_FILENAME: &str = "chaja-undo.json";

/// Reflog message prefix written alongside each tracked op. Lets a human
/// running `git reflog` see chajá's intent without having to read the
/// sidecar.
pub const REFLOG_TAG_PREFIX: &str = "chaja:op=";

#[derive(Debug, Error)]
pub enum UndoLogError {
    #[error("undo log io error at {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("undo log parse error at {path}: {source}")]
    Parse {
        path: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("system clock error: {0}")]
    Clock(#[source] std::time::SystemTimeError),
}

/// Operation archetypes chajá knows how to invert. Each variant carries
/// the minimum metadata sub-PR 2's inverse builder needs — pre-SHA for
/// resets, post-SHA for "undo this commit", stash refs, etc. Anything
/// beyond that gets recovered from `git2` at undo-time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum OpKind {
    /// New commit on the current branch. `parent_sha` is `None` for root
    /// commits — those can't be undone via `reset --soft HEAD~1` (no
    /// parent to step back to) and the inverse builder treats them as
    /// untrackable.
    Commit {
        sha: String,
        parent_sha: Option<String>,
    },
    /// HEAD's commit replaced by an amended one. Reflog still references
    /// `old_sha` for ~90 days; we mirror it in the sidecar so the undo
    /// builder can fall back to the sidecar after GC.
    Amend { old_sha: String, new_sha: String },
    /// Branch checkout — switches HEAD to a different ref. `from` and
    /// `to` are branch short names (without `refs/heads/`).
    CheckoutBranch { from: String, to: String },
    /// Detached-HEAD checkout. `from` is the previous ref name (or the
    /// previous detached SHA) and `to_sha` is the commit checked out.
    CheckoutCommit { from: String, to_sha: String },
    /// `reset --(soft|mixed|hard)` to a target commit. `from_sha` is
    /// HEAD before the reset, `to_sha` is HEAD after.
    Reset {
        mode: ResetMode,
        from_sha: String,
        to_sha: String,
    },
    /// Cherry-pick that produced a new commit. `applied_sha` is the
    /// source; `new_sha` is the cherry-pick result on HEAD.
    CherryPick {
        applied_sha: String,
        new_sha: String,
    },
    /// Revert that produced a new commit. `reverted_sha` is the source;
    /// `new_sha` is the revert commit on HEAD.
    Revert {
        reverted_sha: String,
        new_sha: String,
    },
    /// Merge of `source` into the current branch. `pre_merge_sha` is
    /// HEAD before the merge (the equivalent of `ORIG_HEAD`), needed
    /// for the `reset --hard` inverse. `post_merge_sha` is HEAD after.
    Merge {
        source: String,
        pre_merge_sha: String,
        post_merge_sha: String,
    },
    /// Stash push. `stash_sha` is the new top-of-stash commit so undo
    /// can pop the same stash even if the user pushed others on top
    /// before undoing.
    StashPush { stash_sha: String },
    /// Stash pop. `stash_sha` is the popped stash commit so undo can
    /// re-stash to the same state.
    StashPop { stash_sha: String },
}

impl OpKind {
    /// Human-readable label for toolbar tooltips ("Undo commit", "Undo
    /// merge of feat-x", …). Sub-PR 2 uses this to populate the Undo
    /// button's `title` attribute via `get_undo_redo_state`.
    pub fn human_label(&self) -> String {
        let short = |sha: &str| sha.chars().take(7).collect::<String>();
        match self {
            OpKind::Commit { .. } => "commit".into(),
            OpKind::Amend { .. } => "amend".into(),
            OpKind::CheckoutBranch { to, .. } => format!("checkout to {to}"),
            OpKind::CheckoutCommit { to_sha, .. } => format!("checkout to {}", short(to_sha)),
            OpKind::Reset { to_sha, mode, .. } => {
                format!("{} reset to {}", reset_mode_str(*mode), short(to_sha))
            }
            OpKind::CherryPick { applied_sha, .. } => {
                format!("cherry-pick of {}", short(applied_sha))
            }
            OpKind::Revert { reverted_sha, .. } => format!("revert of {}", short(reverted_sha)),
            OpKind::Merge { source, .. } => format!("merge of {source}"),
            OpKind::StashPush { .. } => "stash push".into(),
            OpKind::StashPop { .. } => "stash pop".into(),
        }
    }

    /// Canonical reflog tag — written as the reflog message of the
    /// underlying ref update. Format: `chaja:op=<kind>|<key>=<value>|...`
    /// kept simple enough that an external grep can find chajá-tagged
    /// entries in `.git/logs/HEAD`.
    pub fn reflog_tag(&self) -> String {
        match self {
            OpKind::Commit { sha, parent_sha } => format!(
                "{}commit|sha={}|parent={}",
                REFLOG_TAG_PREFIX,
                sha,
                parent_sha.as_deref().unwrap_or("none"),
            ),
            OpKind::Amend { old_sha, new_sha } => {
                format!("{}amend|old={}|new={}", REFLOG_TAG_PREFIX, old_sha, new_sha,)
            }
            OpKind::CheckoutBranch { from, to } => {
                format!(
                    "{}checkout-branch|from={}|to={}",
                    REFLOG_TAG_PREFIX, from, to
                )
            }
            OpKind::CheckoutCommit { from, to_sha } => format!(
                "{}checkout-commit|from={}|to={}",
                REFLOG_TAG_PREFIX, from, to_sha,
            ),
            OpKind::Reset {
                mode,
                from_sha,
                to_sha,
            } => format!(
                "{}reset|mode={}|from={}|to={}",
                REFLOG_TAG_PREFIX,
                reset_mode_str(*mode),
                from_sha,
                to_sha,
            ),
            OpKind::CherryPick {
                applied_sha,
                new_sha,
            } => format!(
                "{}cherry-pick|applied={}|new={}",
                REFLOG_TAG_PREFIX, applied_sha, new_sha,
            ),
            OpKind::Revert {
                reverted_sha,
                new_sha,
            } => format!(
                "{}revert|reverted={}|new={}",
                REFLOG_TAG_PREFIX, reverted_sha, new_sha,
            ),
            OpKind::Merge {
                source,
                pre_merge_sha,
                post_merge_sha,
            } => format!(
                "{}merge|source={}|pre={}|post={}",
                REFLOG_TAG_PREFIX, source, pre_merge_sha, post_merge_sha,
            ),
            OpKind::StashPush { stash_sha } => {
                format!("{}stash-push|sha={}", REFLOG_TAG_PREFIX, stash_sha)
            }
            OpKind::StashPop { stash_sha } => {
                format!("{}stash-pop|sha={}", REFLOG_TAG_PREFIX, stash_sha)
            }
        }
    }
}

fn reset_mode_str(mode: ResetMode) -> &'static str {
    match mode {
        ResetMode::Soft => "soft",
        ResetMode::Mixed => "mixed",
        ResetMode::Hard => "hard",
    }
}

/// One entry in the undo log. `timestamp` is unix seconds (matches the
/// reflog's own `committer time` resolution; sub-second granularity adds
/// no value here).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Op {
    pub kind: OpKind,
    pub timestamp: u64,
}

/// Full sidecar structure. `cursor` is the index of the most-recently
/// applied op — typically `ops.len() - 1` after appending. Sub-PR 2's
/// undo decrements it; redo re-increments. Stored explicitly (rather
/// than derived) so a redo cursor surviving across app restarts lines
/// up with where the user left off.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UndoLog {
    pub ops: Vec<Op>,
    pub cursor: Option<usize>,
}

fn sidecar_path(repo_path: &Path) -> PathBuf {
    repo_path.join(".git").join(UNDO_LOG_FILENAME)
}

/// Read the sidecar. Missing file returns the default empty log so the
/// first op of a freshly-cloned repo doesn't need a prelude pass.
pub fn read_log(repo_path: &Path) -> Result<UndoLog, UndoLogError> {
    let path = sidecar_path(repo_path);
    let raw = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(UndoLog::default()),
        Err(e) => {
            return Err(UndoLogError::Io {
                path: path.display().to_string(),
                source: e,
            });
        }
    };
    serde_json::from_slice(&raw).map_err(|e| UndoLogError::Parse {
        path: path.display().to_string(),
        source: e,
    })
}

/// Append an op to the sidecar. Truncates everything after `cursor`
/// before appending — the standard editor pattern: a new operation
/// after an undo discards the redo stack.
///
/// Atomic write: marshal to a `*.tmp`, fsync the file, rename over the
/// final path. Crash-safe against partial writes; concurrent writers
/// would still race the rename, but chajá runs a single backend instance
/// per repo so the only contention is theoretical.
pub fn record_op(repo_path: &Path, kind: OpKind) -> Result<(), UndoLogError> {
    let mut log = read_log(repo_path)?;
    if let Some(cursor) = log.cursor {
        // After an undo, a fresh op clears the redo tail.
        log.ops.truncate(cursor + 1);
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(UndoLogError::Clock)?
        .as_secs();
    log.ops.push(Op { kind, timestamp });
    log.cursor = Some(log.ops.len() - 1);
    write_log(repo_path, &log)
}

/// Best-effort wrapper around `record_op` for callers that have already
/// committed the underlying git operation. The op is real either way;
/// a sidecar write failure must NOT propagate — the only consequence of
/// a log miss is "this op won't be undoable through the toolbar." Logged
/// at warn so users with disk-full / permission issues see a trail.
///
/// Short-circuits when the calling thread has flipped the [`SKIP_RECORD`]
/// guard via [`with_record_skipped`] — that's the path used by undo /
/// redo to replay public op wrappers without ghost-recording.
pub fn record_op_best_effort(repo_path: &Path, kind: OpKind) {
    if SKIP_RECORD.with(|c| c.get()) {
        return;
    }
    if let Err(e) = record_op(repo_path, kind) {
        tracing::warn!(error = %e, "failed to record op in undo log");
    }
}

/// Persist a cursor change. Used by sub-PR 2's `undo_last_operation` to
/// step the cursor backwards after applying an inverse, and by sub-PR 3's
/// redo to step forward again. Bypasses the truncate-on-record path —
/// callers want to move the cursor without losing the redo tail.
pub fn set_cursor(repo_path: &Path, cursor: Option<usize>) -> Result<(), UndoLogError> {
    let mut log = read_log(repo_path)?;
    log.cursor = cursor;
    write_log(repo_path, &log)
}

fn write_log(repo_path: &Path, log: &UndoLog) -> Result<(), UndoLogError> {
    let final_path = sidecar_path(repo_path);
    let parent = final_path.parent().ok_or_else(|| UndoLogError::Io {
        path: final_path.display().to_string(),
        source: std::io::Error::other("sidecar path missing parent directory"),
    })?;
    // The .git directory always exists for an open repo; defensive
    // create_dir_all costs nothing and avoids weird errors on bare
    // workdirs we might support later.
    fs::create_dir_all(parent).map_err(|e| UndoLogError::Io {
        path: parent.display().to_string(),
        source: e,
    })?;
    let tmp_path = final_path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(log).map_err(|e| UndoLogError::Parse {
        path: final_path.display().to_string(),
        source: e,
    })?;
    {
        let mut tmp = fs::File::create(&tmp_path).map_err(|e| UndoLogError::Io {
            path: tmp_path.display().to_string(),
            source: e,
        })?;
        tmp.write_all(&json).map_err(|e| UndoLogError::Io {
            path: tmp_path.display().to_string(),
            source: e,
        })?;
        tmp.sync_all().map_err(|e| UndoLogError::Io {
            path: tmp_path.display().to_string(),
            source: e,
        })?;
    }
    fs::rename(&tmp_path, &final_path).map_err(|e| UndoLogError::Io {
        path: final_path.display().to_string(),
        source: e,
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn fresh_repo() -> TempDir {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        dir
    }

    #[test]
    fn read_missing_returns_default() {
        let repo = fresh_repo();
        let log = read_log(repo.path()).unwrap();
        assert!(log.ops.is_empty());
        assert!(log.cursor.is_none());
    }

    #[test]
    fn record_then_read_roundtrips() {
        let repo = fresh_repo();
        let kind = OpKind::Commit {
            sha: "abc1234".to_string(),
            parent_sha: Some("def5678".to_string()),
        };
        record_op(repo.path(), kind.clone()).unwrap();
        let log = read_log(repo.path()).unwrap();
        assert_eq!(log.ops.len(), 1);
        assert_eq!(log.cursor, Some(0));
        match &log.ops[0].kind {
            OpKind::Commit { sha, parent_sha } => {
                assert_eq!(sha, "abc1234");
                assert_eq!(parent_sha.as_deref(), Some("def5678"));
            }
            _ => panic!("wrong kind"),
        }
    }

    #[test]
    fn new_op_after_undo_truncates_redo_tail() {
        let repo = fresh_repo();
        record_op(
            repo.path(),
            OpKind::Commit {
                sha: "a".into(),
                parent_sha: None,
            },
        )
        .unwrap();
        record_op(
            repo.path(),
            OpKind::Commit {
                sha: "b".into(),
                parent_sha: Some("a".into()),
            },
        )
        .unwrap();
        // Simulate an undo: cursor walks back. (Sub-PR 2 will own this
        // logic; we mock it here to exercise the truncation path.)
        let mut log = read_log(repo.path()).unwrap();
        log.cursor = Some(0);
        write_log(repo.path(), &log).unwrap();
        // New op after the undo should drop the "b" entry.
        record_op(
            repo.path(),
            OpKind::Commit {
                sha: "c".into(),
                parent_sha: Some("a".into()),
            },
        )
        .unwrap();
        let log = read_log(repo.path()).unwrap();
        assert_eq!(log.ops.len(), 2);
        assert!(matches!(
            &log.ops[1].kind,
            OpKind::Commit { sha, .. } if sha == "c"
        ));
        assert_eq!(log.cursor, Some(1));
    }

    #[test]
    fn reflog_tag_format_per_kind() {
        let cases = [
            (
                OpKind::Commit {
                    sha: "abc".into(),
                    parent_sha: Some("def".into()),
                },
                "chaja:op=commit|sha=abc|parent=def",
            ),
            (
                OpKind::Commit {
                    sha: "abc".into(),
                    parent_sha: None,
                },
                "chaja:op=commit|sha=abc|parent=none",
            ),
            (
                OpKind::CheckoutBranch {
                    from: "main".into(),
                    to: "feat".into(),
                },
                "chaja:op=checkout-branch|from=main|to=feat",
            ),
            (
                OpKind::Reset {
                    mode: ResetMode::Hard,
                    from_sha: "a".into(),
                    to_sha: "b".into(),
                },
                "chaja:op=reset|mode=hard|from=a|to=b",
            ),
            (
                OpKind::StashPush {
                    stash_sha: "deadbeef".into(),
                },
                "chaja:op=stash-push|sha=deadbeef",
            ),
        ];
        for (kind, expected) in cases {
            assert_eq!(kind.reflog_tag(), expected);
        }
    }
}
