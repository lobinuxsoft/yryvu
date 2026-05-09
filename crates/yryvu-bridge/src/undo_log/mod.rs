// SPDX-License-Identifier: AGPL-3.0-or-later

//! Per-repo undo/redo operation log.
//!
//! Sub-PR 1 of issue #130: stores the trace of git operations yryvu knows
//! how to invert, so a subsequent `undo` IPC can walk back through the
//! history and replay the inverse.
//!
//! # Why a sidecar
//!
//! GitKraken's bundle reads from `.git/logs/HEAD` (the ref reflog) and
//! caches a parallel stack in redux to avoid hitting disk every render. We
//! follow the same split, with two adjustments:
//!
//! 1. **Sidecar JSON instead of redux.** Yryvu's frontend is reactive and
//!    queries the backend per repo refresh; an in-memory cache buys us
//!    nothing across app restarts. Disk-backed storage survives the user
//!    closing the app mid-session and re-opening to undo something.
//!
//! 2. **Persists past the reflog's GC window.** Git prunes the reflog
//!    after 90 days by default; an undo log driven solely by reflog reads
//!    silently drops history. The sidecar at `.git/yryvu-undo.json`
//!    stores everything yryvu needs (pre/post SHAs, op kind, stash
//!    indexes) without depending on the reflog being intact.
//!
//! The reflog is still tagged with `yryvu:op=<kind>|...` messages on each
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
//! force-push which is not a yryvu-allowed operation).
//!
//! # Module layout
//!
//! - [`errors`]  — `UndoLogError` + `UNDO_LOG_FILENAME` + `REFLOG_TAG_PREFIX`.
//! - [`op_kind`] — `OpKind` enum + `Op` + `UndoLog` data shapes.
//! - [`record`]  — IO surface (`read_log` / `record_op` / `set_cursor` /
//!   `clear_log_best_effort` / `with_record_skipped`).

mod errors;
mod op_kind;
mod record;

pub use errors::{UndoLogError, REFLOG_TAG_PREFIX, UNDO_LOG_FILENAME};
pub use op_kind::{Op, OpKind, UndoLog};
pub use record::{
    clear_log_best_effort, read_log, record_op, record_op_best_effort, set_cursor,
    with_record_skipped,
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::ResetMode;
    use std::fs;
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
        set_cursor(repo.path(), Some(0)).unwrap();
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
                "yryvu:op=commit|sha=abc|parent=def",
            ),
            (
                OpKind::Commit {
                    sha: "abc".into(),
                    parent_sha: None,
                },
                "yryvu:op=commit|sha=abc|parent=none",
            ),
            (
                OpKind::CheckoutBranch {
                    from: "main".into(),
                    to: "feat".into(),
                },
                "yryvu:op=checkout-branch|from=main|to=feat",
            ),
            (
                OpKind::Reset {
                    mode: ResetMode::Hard,
                    from_sha: "a".into(),
                    to_sha: "b".into(),
                },
                "yryvu:op=reset|mode=hard|from=a|to=b",
            ),
            (
                OpKind::StashPush {
                    stash_sha: "deadbeef".into(),
                },
                "yryvu:op=stash-push|sha=deadbeef",
            ),
        ];
        for (kind, expected) in cases {
            assert_eq!(kind.reflog_tag(), expected);
        }
    }
}
