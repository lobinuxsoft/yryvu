// SPDX-License-Identifier: AGPL-3.0-or-later

use std::cell::Cell;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::errors::{UndoLogError, UNDO_LOG_FILENAME};
use super::op_kind::{Op, OpKind, UndoLog};

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

pub(super) fn sidecar_path(repo_path: &Path) -> PathBuf {
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
    // After an undo, a fresh op clears the redo tail. `cursor == None`
    // means everything was undone, so the whole tail is stale — truncate
    // to 0, otherwise the new op is appended behind already-undone ops.
    log.ops.truncate(log.cursor.map_or(0, |c| c + 1));
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(UndoLogError::Clock)?
        .as_secs();
    log.ops.push(Op {
        kind,
        timestamp,
        discarded_dirty: false,
    });
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

/// Flag the entry at `idx` as having cost the user uncommitted work.
///
/// Best-effort for the same reason as [`record_op_best_effort`]: the git
/// side already happened, and a sidecar write failure must not turn a
/// successful undo into an error. The consequence of a miss is a missing
/// caveat in a tooltip, not a wrong operation.
pub fn mark_discarded_dirty_best_effort(repo_path: &Path, idx: usize) {
    let marked = read_log(repo_path).and_then(|mut log| {
        match log.ops.get_mut(idx) {
            Some(op) => op.discarded_dirty = true,
            // Cursor out of range: nothing to annotate, nothing to write.
            None => return Ok(()),
        }
        write_log(repo_path, &log)
    });
    if let Err(e) = marked {
        tracing::warn!(error = %e, "failed to flag discarded work in undo log");
    }
}

/// Clear the undo log entirely. Used by ops that can't be undone AND
/// invalidate the previous history (stash apply / pop / drop — they
/// mutate the working tree in ways that make the prior recorded ops
/// unreplayable). Without this, Cmd+Z after such an op would try to
/// reverse a step whose preconditions no longer hold and surface a
/// confusing error.
///
/// Best-effort: a write failure leaves the log as-is, the worst that
/// can happen is the user sees "Cannot undo" once instead of the
/// log-cleared "Nothing to undo" — both honest but the latter is
/// less surprising.
///
/// Short-circuits under the [`SKIP_RECORD`] guard, same as
/// [`record_op_best_effort`]. An inverse that replays a public op wrapper
/// (e.g. undoing a StashPush calls `stash_pop`, which clears the log) must
/// NOT wipe the history the IPC layer is mid-walk on — that leaves the
/// on-disk cursor out of range and bricks undo/redo across restarts.
pub fn clear_log_best_effort(repo_path: &Path) {
    if SKIP_RECORD.with(|c| c.get()) {
        return;
    }
    if let Err(e) = write_log(repo_path, &UndoLog::default()) {
        tracing::warn!(error = %e, "failed to clear undo log");
    }
}

pub(super) fn write_log(repo_path: &Path, log: &UndoLog) -> Result<(), UndoLogError> {
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
