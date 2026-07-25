// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;
use std::process::Command;

use crate::backend::BackendError;
use crate::undo_log::OpKind;

use super::{apply_inverse, apply_redo, UndoOutcome};

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

/// #474: the toolbar greys these out by asking the same predicate the
/// inverse builder answers with. If the two ever disagree, the button
/// is lit for an op that reports a toast and never moves the cursor.
#[test]
fn untrackable_ops_agree_with_their_predicate() {
    let (_d, p) = repo_with_dirty_tree();
    let cases = [
        OpKind::Commit {
            sha: sha(&p, "HEAD"),
            parent_sha: None,
        },
        OpKind::StashPop {
            stash_sha: "deadbeef".into(),
        },
    ];
    for op in cases {
        let expected = op.undo_untrackable_reason().expect("must be untrackable");
        match apply_inverse(&p, &op, false).unwrap() {
            UndoOutcome::Untrackable { reason } => assert_eq!(reason, expected),
            other => panic!("expected Untrackable for {op:?}, got {other:?}"),
        }
    }
    // A root commit *is* redoable — the two directions are not mirrors.
    assert!(OpKind::Commit {
        sha: sha(&p, "HEAD"),
        parent_sha: None,
    }
    .redo_untrackable_reason()
    .is_none());
}

/// #475: forcing past the dirty dialog costs the user work that no
/// redo brings back. The outcome has to say so, or the UI cannot.
#[test]
fn forced_undo_reports_the_work_it_discarded() {
    let (_d, p) = repo_with_dirty_tree();
    let head = sha(&p, "HEAD");
    let op = OpKind::CherryPick {
        applied_sha: head.clone(),
        new_sha: head,
    };

    let outcome = apply_inverse(&p, &op, true).unwrap();
    assert!(
        matches!(
            outcome,
            UndoOutcome::Applied {
                discarded_dirty: true,
                ..
            }
        ),
        "forced undo over a dirty tree must report the loss, got {outcome:?}"
    );
}

/// …and forcing over a clean tree costs nothing. Reporting a loss
/// there would train the user to ignore the warning that matters.
#[test]
fn forced_undo_on_a_clean_tree_reports_no_loss() {
    let (_d, p) = repo_with_dirty_tree();
    std::fs::remove_file(p.join("mine.txt")).unwrap();
    let head = sha(&p, "HEAD");
    let op = OpKind::CherryPick {
        applied_sha: head.clone(),
        new_sha: head,
    };

    let outcome = apply_inverse(&p, &op, true).unwrap();
    assert!(
        matches!(
            outcome,
            UndoOutcome::Applied {
                discarded_dirty: false,
                ..
            }
        ),
        "nothing was dirty; nothing was lost, got {outcome:?}"
    );
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
