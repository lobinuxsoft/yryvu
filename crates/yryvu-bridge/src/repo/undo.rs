// SPDX-License-Identifier: AGPL-3.0-or-later

//! Inverse builder for the undo log.
//!
//! Sub-PR 2 of issue #130: reads the sidecar that sub-PR 1 (#183 / #184)
//! populates and runs the inverse of the most-recent op when the user
//! clicks `Undo` in the toolbar.
//!
//! # What "inverse" means per OpKind
//!
//! | Op                          | Inverse                                              |
//! |-----------------------------|------------------------------------------------------|
//! | `Commit { parent: Some }`   | `reset --soft parent_sha` — preserves index + worktree |
//! | `Commit { parent: None }`   | not supported (root commit, no parent to step back to) |
//! | `Amend`                     | `reset --hard old_sha` — recovers the pre-amend commit |
//! | `CheckoutBranch`            | `checkout_branch(from)`                              |
//! | `CheckoutCommit`            | `checkout_branch(from)` (or `checkout_commit(from)` if `from` was a SHA) |
//! | `Reset`                     | `reset_to_commit(from_sha, original_mode)` — same mode reverses the same way |
//! | `CherryPick` / `Revert`     | `reset --hard <parent of recorded new_sha>` — verified against HEAD first |
//! | `Merge`                     | `reset --hard pre_merge_sha`                         |
//! | `StashPush`                 | `stash_pop` — re-applies what we just stashed        |
//! | `StashPop`                  | not supported in sub-PR 2 — re-stashing safely needs a heavier index/worktree snapshot than libgit2's `stash_save2` provides |
//!
//! # What this module does NOT do
//!
//! - Walk the cursor — that's the IPC layer's job (`commands/undo.rs`).
//! - Record an inverse-of-inverse op — undo moves the cursor; the redo
//!   path uses the same entries.
//! - Reconstruct content that was never committed. A `reset --hard` does
//!   NOT refuse over a dirty working tree — libgit2's `reset.c` forces
//!   `GIT_CHECKOUT_FORCE` regardless of caller options, and discarding
//!   local changes is what the mode is for. Destructive inverses are
//!   therefore gated on [`guard_dirty`], which refuses unless the caller
//!   passes `force` to say the user was asked and accepted.

use std::path::Path;

use crate::backend::{BackendError, ResetMode};
use crate::undo_log::{with_record_skipped, OpKind};

use super::common::{git2_err, open_git2};
use super::worktree;

/// Outcome of a single `apply_inverse` call. The IPC layer turns
/// `Untrackable` into a "couldn't undo" toast without crashing.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub enum UndoOutcome {
    /// Inverse executed; cursor should advance backward.
    Applied { kind_label: String },
    /// Op exists in the log but cannot be inverted in the current state
    /// (root commit, stash-pop in sub-PR 2, etc). Cursor stays where it
    /// was so the user can move past this entry manually if they want.
    Untrackable { reason: String },
}

/// Does undoing `op` reset the working tree, taking uncommitted work with
/// it? A `--hard` reset is the right call for these inverses — undoing a
/// cherry-pick has to make the commit's content *disappear*, not leave it
/// behind unstaged — but it cannot tell the op's content apart from the
/// user's own uncommitted edits, so it discards both.
///
/// Exhaustive on purpose: a new [`OpKind`] must decide here rather than
/// inherit a permissive default. That omission is how these bugs are born.
fn undo_discards_uncommitted_work(op: &OpKind) -> bool {
    match op {
        // Soft reset: the tree is left exactly as it is.
        OpKind::Commit { .. } => false,
        OpKind::Amend { .. } => true,
        // Safe checkout — refuses on a dirty tree by itself.
        OpKind::CheckoutBranch { .. } | OpKind::CheckoutCommit { .. } => false,
        OpKind::Reset { mode, .. } => matches!(mode, ResetMode::Hard),
        OpKind::CherryPick { .. } | OpKind::Revert { .. } | OpKind::Merge { .. } => true,
        // Pops the stash back — applies, never resets.
        OpKind::StashPush { .. } => false,
        // Reported as untrackable; nothing runs.
        OpKind::StashPop { .. } => false,
    }
}

/// Same question for the redo direction, which reaches forward with a
/// `--hard` reset to a commit that still exists in the reflog.
fn redo_discards_uncommitted_work(op: &OpKind) -> bool {
    match op {
        // Soft reset: leaves the tree alone, same as its undo.
        OpKind::Commit { .. } => false,
        OpKind::Amend { .. }
        | OpKind::CherryPick { .. }
        | OpKind::Revert { .. }
        | OpKind::Merge { .. } => true,
        OpKind::CheckoutBranch { .. } | OpKind::CheckoutCommit { .. } => false,
        OpKind::Reset { mode, .. } => matches!(mode, ResetMode::Hard),
        // Re-stashes whatever is in the tree; captures rather than destroys.
        OpKind::StashPush { .. } => false,
        OpKind::StashPop { .. } => false,
    }
}

/// Refuse a destructive undo/redo over a dirty tree unless `force` says the
/// user was asked and accepted. `reset --hard` never refuses on its own
/// (libgit2 `reset.c` forces `GIT_CHECKOUT_FORCE` regardless of caller
/// options), so this is the only thing standing between a reflex Ctrl+Z and
/// the user's uncommitted work.
fn guard_dirty(repo_path: &Path, destructive: bool, force: bool) -> Result<(), BackendError> {
    if destructive && !force && worktree::is_working_tree_dirty(repo_path)? {
        return Err(BackendError::WorkingTreeDirty);
    }
    Ok(())
}

/// Apply the inverse of `op` against `repo_path`. Errors propagate as
/// `BackendError` so the UI can surface them through its standard
/// notification channel.
///
/// Destructive inverses refuse over a dirty working tree unless `force`;
/// see [`guard_dirty`].
///
/// The whole match runs inside [`with_record_skipped`] so the public op
/// wrappers we delegate to (`checkout_branch`, `reset_to_commit`, …)
/// don't append fresh log entries — undo moves the cursor backwards,
/// it doesn't synthesise a "undo of X" record.
pub fn apply_inverse(
    repo_path: &Path,
    op: &OpKind,
    force: bool,
) -> Result<UndoOutcome, BackendError> {
    guard_dirty(repo_path, undo_discards_uncommitted_work(op), force)?;
    with_record_skipped(|| apply_inverse_inner(repo_path, op))
}

fn apply_inverse_inner(repo_path: &Path, op: &OpKind) -> Result<UndoOutcome, BackendError> {
    match op {
        OpKind::Commit {
            parent_sha: Some(parent_sha),
            ..
        } => {
            soft_reset(repo_path, parent_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "commit".into(),
            })
        }
        OpKind::Commit {
            parent_sha: None, ..
        } => Ok(UndoOutcome::Untrackable {
            reason: "root commit cannot be undone".into(),
        }),
        OpKind::Amend { old_sha, .. } => {
            hard_reset(repo_path, old_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "amend".into(),
            })
        }
        OpKind::CheckoutBranch { from, .. } => {
            worktree::checkout_branch(repo_path, from)?;
            Ok(UndoOutcome::Applied {
                kind_label: "checkout".into(),
            })
        }
        OpKind::CheckoutCommit { from, .. } => {
            // `from` may be a branch shorthand or a 40-char SHA — try
            // branch first, fall back to commit checkout. Detached HEADs
            // round-trip as the SHA string.
            match worktree::checkout_branch(repo_path, from) {
                Ok(()) => Ok(UndoOutcome::Applied {
                    kind_label: "checkout".into(),
                }),
                Err(BackendError::BranchNotFound { .. }) => {
                    worktree::checkout_commit(repo_path, from)?;
                    Ok(UndoOutcome::Applied {
                        kind_label: "checkout".into(),
                    })
                }
                Err(e) => Err(e),
            }
        }
        OpKind::Reset { from_sha, mode, .. } => {
            // Reset with the same mode against the original from-sha
            // inverts a Soft reset exactly. For Mixed the original reset
            // re-read the tree into the index (reset.c), discarding the
            // staging; this inverse restores content but NOT the prior
            // staging state — files come back unstaged. No content is
            // lost. (Restoring the index is tracked separately — it needs
            // OpKind::Reset to record the pre-reset index tree.) Note: we
            // go through the public `reset_to_commit` helper so the inverse itself
            // appends a new log entry — that means consecutive undos of
            // a reset will keep stepping back through history.
            // Acceptable for sub-PR 2; the cursor logic in commands/undo.rs
            // handles the bookkeeping.
            worktree::reset_to_commit(repo_path, from_sha, *mode)?;
            Ok(UndoOutcome::Applied {
                kind_label: "reset".into(),
            })
        }
        OpKind::CherryPick { new_sha, .. } | OpKind::Revert { new_sha, .. } => {
            let label = if matches!(op, OpKind::CherryPick { .. }) {
                "cherry-pick"
            } else {
                "revert"
            };
            reset_synthesised_commit(repo_path, new_sha, label)
        }
        OpKind::Merge { pre_merge_sha, .. } => {
            hard_reset(repo_path, pre_merge_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "merge".into(),
            })
        }
        OpKind::StashPush { stash_sha, .. } => {
            // Pop the exact stash we pushed, not whatever is on top now —
            // the user may have stashed again since.
            worktree::stash_pop_by_sha(repo_path, stash_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "stash push".into(),
            })
        }
        OpKind::StashPop { .. } => Ok(UndoOutcome::Untrackable {
            reason: "stash pop undo not supported yet".into(),
        }),
    }
}

fn soft_reset(repo_path: &Path, sha: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let oid = git2::Oid::from_str(sha).map_err(|_| BackendError::CommitNotFound {
        sha: sha.to_string(),
    })?;
    let obj = repo
        .find_object(oid, None)
        .map_err(|_| BackendError::CommitNotFound {
            sha: sha.to_string(),
        })?;
    repo.reset(&obj, git2::ResetType::Soft, None)
        .map_err(git2_err)?;
    Ok(())
}

fn hard_reset(repo_path: &Path, sha: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let oid = git2::Oid::from_str(sha).map_err(|_| BackendError::CommitNotFound {
        sha: sha.to_string(),
    })?;
    let obj = repo
        .find_object(oid, None)
        .map_err(|_| BackendError::CommitNotFound {
            sha: sha.to_string(),
        })?;
    repo.reset(&obj, git2::ResetType::Hard, None)
        .map_err(git2_err)?;
    Ok(())
}

/// Undo a cherry-pick / revert by hard-resetting to the parent of the
/// commit it created — but only after confirming HEAD *still is* that
/// commit. Both ops synthesise a single-parent commit on top of HEAD, so
/// their inverse is a reset to that parent.
///
/// Doing it relative to HEAD (`HEAD~1`) was blind: any commit made outside
/// the app (or a sidecar write that silently failed) leaves HEAD pointing
/// at the user's own work, and `reset --hard HEAD~1` would destroy that
/// instead of the op's commit — the exact opposite of what "undo the
/// cherry-pick" means. The `Merge` and `Commit` arms already reset by
/// recorded SHA; this brings cherry-pick / revert in line (#461).
fn reset_synthesised_commit(
    repo_path: &Path,
    new_sha: &str,
    label: &str,
) -> Result<UndoOutcome, BackendError> {
    let repo = open_git2(repo_path)?;
    let expected = git2::Oid::from_str(new_sha).map_err(|_| BackendError::CommitNotFound {
        sha: new_sha.to_string(),
    })?;
    let head_oid = repo
        .head()
        .map_err(git2_err)?
        .peel_to_commit()
        .map_err(git2_err)?
        .id();
    if head_oid != expected {
        return Err(BackendError::UndoHeadMismatch {
            op: label.to_string(),
        });
    }
    let commit = repo
        .find_commit(expected)
        .map_err(|_| BackendError::CommitNotFound {
            sha: new_sha.to_string(),
        })?;
    let parent = commit.parent(0).map_err(git2_err)?;
    let obj = repo.find_object(parent.id(), None).map_err(git2_err)?;
    repo.reset(&obj, git2::ResetType::Hard, None)
        .map_err(git2_err)?;
    Ok(UndoOutcome::Applied {
        kind_label: label.into(),
    })
}

/// Re-apply `op` after an undo (sub-PR 3 of #130). Mirrors `apply_inverse`
/// but going forward: for any commit-creating op (Commit / Amend /
/// CherryPick / Revert / Merge) the synthesised commit still lives in
/// the reflog (and on disk), so a single `reset --hard <new_sha>` is
/// enough to restore HEAD without reconstructing the tree. Checkout /
/// reset / stash variants delegate to the public worktree helpers,
/// silenced by `with_record_skipped` so the redo doesn't ghost-record.
pub fn apply_redo(repo_path: &Path, op: &OpKind, force: bool) -> Result<UndoOutcome, BackendError> {
    guard_dirty(repo_path, redo_discards_uncommitted_work(op), force)?;
    with_record_skipped(|| apply_redo_inner(repo_path, op))
}

fn apply_redo_inner(repo_path: &Path, op: &OpKind) -> Result<UndoOutcome, BackendError> {
    match op {
        OpKind::Commit { sha, .. } => {
            // Soft, mirroring the undo. The undo of a commit is a soft
            // reset that deliberately keeps the content staged, so redoing
            // it only has to move HEAD back onto the commit that already
            // holds that content. A hard reset here would destroy work the
            // undo went out of its way to preserve — and, since the undo
            // leaves the tree dirty by design, would also trip the dirty
            // guard and make this redo unreachable.
            soft_reset(repo_path, sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "commit".into(),
            })
        }
        OpKind::Amend { new_sha, .. } => {
            hard_reset(repo_path, new_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "amend".into(),
            })
        }
        OpKind::CheckoutBranch { to, .. } => {
            worktree::checkout_branch(repo_path, to)?;
            Ok(UndoOutcome::Applied {
                kind_label: "checkout".into(),
            })
        }
        OpKind::CheckoutCommit { to_sha, .. } => {
            worktree::checkout_commit(repo_path, to_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "checkout".into(),
            })
        }
        OpKind::Reset { mode, to_sha, .. } => {
            worktree::reset_to_commit(repo_path, to_sha, *mode)?;
            Ok(UndoOutcome::Applied {
                kind_label: "reset".into(),
            })
        }
        OpKind::CherryPick { new_sha, .. } => {
            hard_reset(repo_path, new_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "cherry-pick".into(),
            })
        }
        OpKind::Revert { new_sha, .. } => {
            hard_reset(repo_path, new_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "revert".into(),
            })
        }
        OpKind::Merge { post_merge_sha, .. } => {
            hard_reset(repo_path, post_merge_sha)?;
            Ok(UndoOutcome::Applied {
                kind_label: "merge".into(),
            })
        }
        OpKind::StashPush {
            include_untracked,
            include_ignored,
            ..
        } => {
            // Re-stashing the current working tree captures whatever's
            // there now — assumed identical to the pre-undo state since
            // the user just popped it back. Producing a different stash
            // SHA than the original is fine: the cursor walk doesn't
            // care about SHA equality. Mirror the original op's flags so
            // the redo captures the same scope it did the first time.
            worktree::stash_push(repo_path, None, *include_untracked, *include_ignored)?;
            Ok(UndoOutcome::Applied {
                kind_label: "stash push".into(),
            })
        }
        OpKind::StashPop { .. } => Ok(UndoOutcome::Untrackable {
            reason: "stash pop redo not supported (symmetric with undo)".into(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(repo)
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn sha(repo: &Path, rev: &str) -> String {
        String::from_utf8(
            Command::new("git")
                .args(["rev-parse", rev])
                .current_dir(repo)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string()
    }

    /// Two commits on `main`, then an uncommitted edit to a file the undo
    /// target never touched — the user's own in-flight work.
    fn repo_with_dirty_tree() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_path_buf();
        git(&p, &["init", "-q", "-b", "main"]);
        git(&p, &["config", "user.name", "t"]);
        git(&p, &["config", "user.email", "t@t"]);
        std::fs::write(p.join("a.txt"), "v1\n").unwrap();
        git(&p, &["add", "."]);
        git(&p, &["commit", "-qm", "first"]);
        std::fs::write(p.join("b.txt"), "second\n").unwrap();
        git(&p, &["add", "."]);
        git(&p, &["commit", "-qm", "second"]);

        std::fs::write(p.join("mine.txt"), "work in progress\n").unwrap();
        (dir, p)
    }

    /// Ctrl+Z is a reflex, not a decision. A destructive undo over a dirty
    /// tree must refuse rather than silently discard the user's work.
    #[test]
    fn destructive_undo_refuses_on_a_dirty_tree() {
        let (_d, p) = repo_with_dirty_tree();
        let op = OpKind::CherryPick {
            applied_sha: sha(&p, "HEAD"),
            new_sha: sha(&p, "HEAD"),
        };

        let err = apply_inverse(&p, &op, false).unwrap_err();
        assert!(
            matches!(err, BackendError::WorkingTreeDirty),
            "expected WorkingTreeDirty, got {err:?}"
        );
        assert_eq!(
            std::fs::read_to_string(p.join("mine.txt")).unwrap(),
            "work in progress\n",
            "uncommitted work was destroyed"
        );
    }

    /// `force` means the user was asked and accepted — it must go through.
    #[test]
    fn destructive_undo_proceeds_when_forced() {
        let (_d, p) = repo_with_dirty_tree();
        let head = sha(&p, "HEAD");
        let parent = sha(&p, "HEAD~1");
        let op = OpKind::CherryPick {
            applied_sha: head.clone(),
            new_sha: head,
        };

        apply_inverse(&p, &op, true).unwrap();
        assert_eq!(sha(&p, "HEAD"), parent, "the undo did not run");
    }

    /// Undoing a commit uses a soft reset, which leaves the tree alone.
    /// It must keep working on a dirty tree — over-refusing would make
    /// Ctrl+Z useless in the most common case of all.
    #[test]
    fn undoing_a_commit_still_works_on_a_dirty_tree() {
        let (_d, p) = repo_with_dirty_tree();
        let parent = sha(&p, "HEAD~1");
        let op = OpKind::Commit {
            sha: sha(&p, "HEAD"),
            parent_sha: Some(parent.clone()),
        };

        apply_inverse(&p, &op, false).unwrap();
        assert_eq!(sha(&p, "HEAD"), parent);
        assert_eq!(
            std::fs::read_to_string(p.join("mine.txt")).unwrap(),
            "work in progress\n",
            "a soft reset must not touch the working tree"
        );
    }

    /// A clean tree has nothing to lose: no prompt, no refusal.
    #[test]
    fn destructive_undo_runs_freely_on_a_clean_tree() {
        let (_d, p) = repo_with_dirty_tree();
        std::fs::remove_file(p.join("mine.txt")).unwrap();
        let parent = sha(&p, "HEAD~1");
        let op = OpKind::CherryPick {
            applied_sha: sha(&p, "HEAD"),
            new_sha: sha(&p, "HEAD"),
        };

        apply_inverse(&p, &op, false).unwrap();
        assert_eq!(sha(&p, "HEAD"), parent);
    }

    /// The heart of #461: after a commit made outside the app, HEAD no
    /// longer points at the cherry-pick. A blind `reset --hard HEAD~1`
    /// would destroy that outside commit; the recorded-SHA check must
    /// refuse instead, leaving HEAD exactly where it is.
    #[test]
    fn cherry_pick_undo_refuses_when_head_moved() {
        let (_d, p) = repo_with_dirty_tree();
        std::fs::remove_file(p.join("mine.txt")).unwrap();
        // The cherry-pick result is the current HEAD.
        let cherry = sha(&p, "HEAD");
        // A commit made outside the app: HEAD advances, unrecorded.
        std::fs::write(p.join("outside.txt"), "my own work\n").unwrap();
        git(&p, &["add", "."]);
        git(&p, &["commit", "-qm", "outside work"]);
        let outside = sha(&p, "HEAD");

        let op = OpKind::CherryPick {
            applied_sha: cherry.clone(),
            new_sha: cherry,
        };
        let err = apply_inverse(&p, &op, false).unwrap_err();
        assert!(
            matches!(err, BackendError::UndoHeadMismatch { .. }),
            "expected UndoHeadMismatch, got {err:?}"
        );
        assert_eq!(
            sha(&p, "HEAD"),
            outside,
            "the outside commit must survive an undo it wasn't the target of"
        );
        assert_eq!(
            std::fs::read_to_string(p.join("outside.txt")).unwrap(),
            "my own work\n"
        );
    }

    /// The redo of a hard-reset-forward op is just as destructive as its
    /// undo. (Commit is deliberately absent here: its redo is a soft reset,
    /// see `commit_undo_redo_round_trips_without_force`.)
    #[test]
    fn destructive_redo_refuses_on_a_dirty_tree() {
        let (_d, p) = repo_with_dirty_tree();
        let op = OpKind::Merge {
            source: "feature".into(),
            pre_merge_sha: sha(&p, "HEAD~1"),
            post_merge_sha: sha(&p, "HEAD"),
        };

        let err = apply_redo(&p, &op, false).unwrap_err();
        assert!(
            matches!(err, BackendError::WorkingTreeDirty),
            "expected WorkingTreeDirty, got {err:?}"
        );
        assert_eq!(
            std::fs::read_to_string(p.join("mine.txt")).unwrap(),
            "work in progress\n"
        );
    }

    /// The most common round-trip there is: commit, undo, redo. The undo is
    /// a soft reset, so it leaves the content staged — the redo must not
    /// read its own undo's leftovers as "uncommitted work at risk" and
    /// refuse, nor hard-reset over work the undo preserved on purpose.
    #[test]
    fn commit_undo_redo_round_trips_without_force() {
        let (_d, p) = repo_with_dirty_tree();
        std::fs::remove_file(p.join("mine.txt")).unwrap();
        let head = sha(&p, "HEAD");
        let parent = sha(&p, "HEAD~1");
        let op = OpKind::Commit {
            sha: head.clone(),
            parent_sha: Some(parent.clone()),
        };

        apply_inverse(&p, &op, false).unwrap();
        assert_eq!(sha(&p, "HEAD"), parent, "undo did not step back");

        apply_redo(&p, &op, false).expect("redo must not need force");
        assert_eq!(sha(&p, "HEAD"), head, "redo did not restore HEAD");
    }

    /// Unrelated work in flight survives the whole round-trip.
    #[test]
    fn commit_redo_preserves_unrelated_uncommitted_work() {
        let (_d, p) = repo_with_dirty_tree();
        let head = sha(&p, "HEAD");
        let op = OpKind::Commit {
            sha: head.clone(),
            parent_sha: Some(sha(&p, "HEAD~1")),
        };

        apply_inverse(&p, &op, false).unwrap();
        apply_redo(&p, &op, false).expect("redo must not need force");

        assert_eq!(sha(&p, "HEAD"), head);
        assert_eq!(
            std::fs::read_to_string(p.join("mine.txt")).unwrap(),
            "work in progress\n",
            "redoing a commit destroyed unrelated uncommitted work"
        );
    }
}
