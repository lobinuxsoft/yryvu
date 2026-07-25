// SPDX-License-Identifier: AGPL-3.0-or-later

//! Edit/conflict pauses and the continue / skip / abort transitions.

use std::fs;
use std::path::Path;

use super::*;

#[test]
fn edit_pauses_then_continues() {
    let (_d, path, base, [a, b, c]) = three_commit_topic();
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Edit),
            plan_step(c, RebaseAction::Pick),
        ],
    };
    let state = begin_rebase(&path, plan).unwrap();
    assert_eq!(state.pause_reason, Some(PauseReason::Edit));
    assert_eq!(state.current_step, 1);
    let state2 = continue_rebase(&path).unwrap();
    assert!(state2.pause_reason.is_none());
    assert_eq!(state2.current_step, 3);
    assert!(path.join("c.txt").exists());
}

#[test]
fn conflict_pauses_with_unresolved_index() {
    let (_d, path) = init_repo();
    let base = commit_file(&path, "shared.txt", "v0\n", "base");
    let main_v1 = commit_file(&path, "shared.txt", "v1-main\n", "main v1");

    let repo = git2::Repository::open(&path).unwrap();
    repo.branch("topic", &repo.find_commit(base).unwrap(), false)
        .unwrap();
    repo.set_head("refs/heads/topic").unwrap();
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).unwrap();
    let topic_v1 = commit_file(&path, "shared.txt", "v1-topic\n", "topic v1");

    let plan = RebasePlan {
        onto: main_v1.to_string(),
        steps: vec![plan_step(topic_v1, RebaseAction::Pick)],
    };
    let state = begin_rebase(&path, plan).unwrap();
    assert_eq!(state.pause_reason, Some(PauseReason::Conflict));
    let repo = git2::Repository::open(&path).unwrap();
    assert!(repo.index().unwrap().has_conflicts());
}

#[test]
fn abort_restores_original_head() {
    let (_d, path, base, [a, b, _c]) = three_commit_topic();
    let original = head_oid(&path);
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Edit),
        ],
    };
    let state = begin_rebase(&path, plan).unwrap();
    assert_eq!(state.pause_reason, Some(PauseReason::Edit));
    abort_rebase(&path).unwrap();
    assert_eq!(head_oid(&path), original);
    assert!(get_state(&path).unwrap().is_none());
}

#[test]
fn skip_step_advances_past_conflict() {
    let (_d, path) = init_repo();
    let base = commit_file(&path, "shared.txt", "v0\n", "base");
    let main_v1 = commit_file(&path, "shared.txt", "v1-main\n", "main v1");

    let repo = git2::Repository::open(&path).unwrap();
    repo.branch("topic", &repo.find_commit(base).unwrap(), false)
        .unwrap();
    repo.set_head("refs/heads/topic").unwrap();
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).unwrap();
    let topic_v1 = commit_file(&path, "shared.txt", "v1-topic\n", "topic v1");
    // A second commit on topic that does NOT conflict (touches a new file).
    let topic_independent = commit_file(&path, "fresh.txt", "fresh\n", "topic fresh");

    let plan = RebasePlan {
        onto: main_v1.to_string(),
        steps: vec![
            plan_step(topic_v1, RebaseAction::Pick),
            plan_step(topic_independent, RebaseAction::Pick),
        ],
    };
    let state = begin_rebase(&path, plan).unwrap();
    assert_eq!(state.pause_reason, Some(PauseReason::Conflict));
    let after = skip_step(&path).unwrap();
    assert!(after.pause_reason.is_none());
    assert_eq!(after.current_step, 2);
    assert!(path.join("fresh.txt").exists());
}

/// #451: a staged edit made during an `edit` pause must be amended into the
/// step's commit, not silently discarded by the finishing force-checkout.
#[test]
fn edit_amends_staged_changes_into_the_step_commit() {
    let (_d, path, base, [a, b, c]) = three_commit_topic();
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Edit),
            plan_step(c, RebaseAction::Pick),
        ],
    };
    let state = begin_rebase(&path, plan).unwrap();
    assert_eq!(state.pause_reason, Some(PauseReason::Edit));

    // Edit b.txt during the pause and stage it, as the yryvu staging panel does.
    fs::write(path.join("b.txt"), "B edited\n").unwrap();
    let repo = git2::Repository::open(&path).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("b.txt")).unwrap();
    index.write().unwrap();

    let state2 = continue_rebase(&path).unwrap();
    assert!(state2.pause_reason.is_none());
    assert_eq!(state2.current_step, 3);

    // The finishing force-checkout rebuilds the tree from the commits, so a
    // surviving edit proves it landed in history, not just in the worktree.
    let repo = git2::Repository::open(&path).unwrap();
    let head_tree = repo.head().unwrap().peel_to_tree().unwrap();
    let entry = head_tree.get_path(Path::new("b.txt")).unwrap();
    let blob = repo.find_blob(entry.id()).unwrap();
    assert_eq!(
        std::str::from_utf8(blob.content()).unwrap(),
        "B edited\n",
        "the staged edit was not amended into the rebased history"
    );
    // The later Pick of c still applied on top of the amended commit.
    assert!(path.join("c.txt").exists());
}

/// #460: when `run_pending` errors mid-plan after committing a step, the
/// advanced state must be persisted, or the next `continue` reloads the old
/// cursor and re-applies the already-committed step (a duplicate). Here the
/// second Pick's cherry-pick fails because it would overwrite an untracked
/// file left in the working tree — a hard error, not a graceful conflict.
#[test]
fn continue_persists_progress_when_a_later_step_errors() {
    let (_d, path) = init_repo();
    let base = commit_file(&path, "shared.txt", "v0\n", "base");
    let main_v1 = commit_file(&path, "shared.txt", "v1-main\n", "main v1");

    let repo = git2::Repository::open(&path).unwrap();
    repo.branch("topic", &repo.find_commit(base).unwrap(), false)
        .unwrap();
    repo.set_head("refs/heads/topic").unwrap();
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).unwrap();
    // Step 0 conflicts on shared.txt; step 1 creates new.txt.
    let topic_v1 = commit_file(&path, "shared.txt", "v1-topic\n", "topic v1");
    let topic_new = commit_file(&path, "new.txt", "from-commit\n", "topic new file");

    let plan = RebasePlan {
        onto: main_v1.to_string(),
        steps: vec![
            plan_step(topic_v1, RebaseAction::Pick),
            plan_step(topic_new, RebaseAction::Pick),
        ],
    };
    let state = begin_rebase(&path, plan).unwrap();
    assert_eq!(state.pause_reason, Some(PauseReason::Conflict));

    // Resolve the conflict and stage it.
    fs::write(path.join("shared.txt"), "resolved\n").unwrap();
    let repo = git2::Repository::open(&path).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("shared.txt")).unwrap();
    index.write().unwrap();
    // Leave an untracked new.txt so step 1's cherry-pick hard-errors.
    fs::write(path.join("new.txt"), "UNTRACKED, must not be overwritten\n").unwrap();

    // Continue: step 0 commits, then step 1 errors inside run_pending.
    let err = continue_rebase(&path).unwrap_err();
    assert!(matches!(err, BackendError::Git(_)), "got {err:?}");

    // The advanced cursor must be on disk (step 0 done → current_step 1),
    // not the stale 0 that would re-commit step 0 on the next continue.
    let persisted = get_state(&path).unwrap().unwrap();
    assert_eq!(
        persisted.current_step, 1,
        "progress was not persisted — a later continue would duplicate step 0"
    );
    // Exactly one commit landed on top of the onto; no duplicate.
    assert_eq!(
        commits_since(&path, main_v1).len(),
        1,
        "step 0 was applied more than once"
    );
    // The untracked file the user had was never clobbered.
    assert_eq!(
        fs::read_to_string(path.join("new.txt")).unwrap(),
        "UNTRACKED, must not be overwritten\n"
    );
}

/// #451 (fidelity to git): unstaged changes during an `edit` pause abort the
/// continue instead of being silently dropped. The rebase stays paused so the
/// user can stage them.
#[test]
fn edit_continue_aborts_on_unstaged_changes() {
    let (_d, path, base, [a, b, c]) = three_commit_topic();
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Edit),
            plan_step(c, RebaseAction::Pick),
        ],
    };
    begin_rebase(&path, plan).unwrap();

    // Edit b.txt but do NOT stage it.
    fs::write(path.join("b.txt"), "B unstaged\n").unwrap();

    let err = continue_rebase(&path).unwrap_err();
    assert!(
        matches!(err, BackendError::Git(_)),
        "expected a typed error, got {err:?}"
    );
    // The edit survives untouched, and the rebase is still paused on the step.
    assert_eq!(
        fs::read_to_string(path.join("b.txt")).unwrap(),
        "B unstaged\n",
        "the unstaged edit was destroyed"
    );
    let state = get_state(&path).unwrap().unwrap();
    assert_eq!(state.pause_reason, Some(PauseReason::Edit));
    assert_eq!(state.current_step, 1);
}
