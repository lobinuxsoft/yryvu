// SPDX-License-Identifier: AGPL-3.0-or-later

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::*;

fn init_repo() -> (TempDir, PathBuf) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().to_path_buf();
    let repo = git2::Repository::init(&path).unwrap();
    let mut cfg = repo.config().unwrap();
    cfg.set_str("user.name", "Test").unwrap();
    cfg.set_str("user.email", "test@example.com").unwrap();
    cfg.set_str("commit.gpgsign", "false").unwrap();
    (dir, path)
}

fn commit_file(repo_path: &Path, file: &str, content: &str, message: &str) -> git2::Oid {
    fs::write(repo_path.join(file), content).unwrap();
    let repo = git2::Repository::open(repo_path).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new(file)).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = git2::Signature::now("Test", "test@example.com").unwrap();
    let parents: Vec<git2::Commit<'_>> = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .into_iter()
        .collect();
    let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
        .unwrap()
}

/// Repo skeleton used by most tests: `base` commit on `main`, three
/// commits A → B → C on `topic` each touching a distinct file. Topic
/// is checked out; returns the base oid plus A/B/C oids.
fn three_commit_topic() -> (TempDir, PathBuf, git2::Oid, [git2::Oid; 3]) {
    let (dir, path) = init_repo();
    let base = commit_file(&path, "base.txt", "base\n", "base");
    let repo = git2::Repository::open(&path).unwrap();
    repo.branch("topic", &repo.find_commit(base).unwrap(), false)
        .unwrap();
    repo.set_head("refs/heads/topic").unwrap();
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).unwrap();
    let a = commit_file(&path, "a.txt", "A\n", "commit A");
    let b = commit_file(&path, "b.txt", "B\n", "commit B");
    let c = commit_file(&path, "c.txt", "C\n", "commit C");
    (dir, path, base, [a, b, c])
}

fn head_oid(repo_path: &Path) -> git2::Oid {
    let repo = git2::Repository::open(repo_path).unwrap();
    let head = repo.head().unwrap();
    let commit = head.peel_to_commit().unwrap();
    commit.id()
}

fn head_message(repo_path: &Path) -> String {
    let repo = git2::Repository::open(repo_path).unwrap();
    let head = repo.head().unwrap();
    let commit = head.peel_to_commit().unwrap();
    commit.message().unwrap_or("").to_string()
}

fn commits_since(repo_path: &Path, base: git2::Oid) -> Vec<git2::Oid> {
    let repo = git2::Repository::open(repo_path).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap().id();
    let mut rw = repo.revwalk().unwrap();
    rw.push(head).unwrap();
    rw.hide(base).unwrap();
    rw.map(|r| r.unwrap()).collect()
}

fn plan_step(oid: git2::Oid, action: RebaseAction) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action,
        new_message: None,
    }
}

#[test]
fn list_commits_returns_topic_only() {
    let (_d, path, base, [a, b, c]) = three_commit_topic();
    let listed = list_commits_for_rebase(&path, &base.to_string()).unwrap();
    let ids: Vec<String> = listed.iter().map(|c| c.oid.clone()).collect();
    assert_eq!(ids, vec![c.to_string(), b.to_string(), a.to_string()]);
}

#[test]
fn pick_only_reorder_preserves_files() {
    let (_d, path, base, [a, b, c]) = three_commit_topic();
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(c, RebaseAction::Pick),
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Pick),
        ],
    };
    let state = begin_rebase(&path, plan).unwrap();
    assert!(state.pause_reason.is_none());
    assert_eq!(state.current_step, 3);
    assert!(path.join("a.txt").exists());
    assert!(path.join("b.txt").exists());
    assert!(path.join("c.txt").exists());
    assert_eq!(commits_since(&path, base).len(), 3);
}

#[test]
fn reword_replaces_message() {
    let (_d, path, base, [a, _b, _c]) = three_commit_topic();
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![RebaseStep {
            oid: a.to_string(),
            action: RebaseAction::Reword,
            new_message: Some("reworded subject".to_string()),
        }],
    };
    begin_rebase(&path, plan).unwrap();
    assert_eq!(head_message(&path).trim(), "reworded subject");
}

#[test]
fn squash_concatenates_messages() {
    let (_d, path, base, [a, b, _c]) = three_commit_topic();
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Squash),
        ],
    };
    begin_rebase(&path, plan).unwrap();
    let msg = head_message(&path);
    assert!(msg.contains("commit A"), "msg = {msg:?}");
    assert!(msg.contains("commit B"), "msg = {msg:?}");
    assert_eq!(commits_since(&path, base).len(), 1);
}

#[test]
fn fixup_keeps_parent_message() {
    let (_d, path, base, [a, b, _c]) = three_commit_topic();
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Fixup),
        ],
    };
    begin_rebase(&path, plan).unwrap();
    let msg = head_message(&path);
    assert!(msg.contains("commit A"));
    assert!(!msg.contains("commit B"), "fixup leaked B msg: {msg:?}");
}

#[test]
fn drop_skips_commit_entirely() {
    let (_d, path, base, [a, b, c]) = three_commit_topic();
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Drop),
            plan_step(c, RebaseAction::Pick),
        ],
    };
    begin_rebase(&path, plan).unwrap();
    assert!(path.join("a.txt").exists());
    assert!(path.join("c.txt").exists());
    assert!(
        !path.join("b.txt").exists(),
        "b.txt should have been dropped"
    );
    assert_eq!(commits_since(&path, base).len(), 2);
}

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

#[test]
fn list_commits_filters_merge_commits() {
    let (_d, path) = init_repo();
    let base = commit_file(&path, "base.txt", "base\n", "base");
    // Create side branch with one commit.
    let repo = git2::Repository::open(&path).unwrap();
    repo.branch("side", &repo.find_commit(base).unwrap(), false)
        .unwrap();
    repo.set_head("refs/heads/side").unwrap();
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).unwrap();
    let side_commit = commit_file(&path, "side.txt", "side\n", "side commit");
    // Back to default branch, add another commit.
    repo.set_head("refs/heads/master")
        .or_else(|_| repo.set_head("refs/heads/main"))
        .unwrap();
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).unwrap();
    let main_commit = commit_file(&path, "main.txt", "main\n", "main commit");
    // Create a merge commit on the default branch.
    let main = repo.find_commit(main_commit).unwrap();
    let side = repo.find_commit(side_commit).unwrap();
    let mut idx = repo.merge_commits(&main, &side, None).unwrap();
    let tree_oid = idx.write_tree_to(&repo).unwrap();
    let tree = repo.find_tree(tree_oid).unwrap();
    let sig = git2::Signature::now("Test", "test@example.com").unwrap();
    let merge_oid = repo
        .commit(
            Some("HEAD"),
            &sig,
            &sig,
            "merge side",
            &tree,
            &[&main, &side],
        )
        .unwrap();

    let listed = list_commits_for_rebase(&path, &base.to_string()).unwrap();
    let ids: Vec<String> = listed.iter().map(|c| c.oid.clone()).collect();
    assert!(
        !ids.contains(&merge_oid.to_string()),
        "merge commit should be filtered out"
    );
    assert!(ids.contains(&main_commit.to_string()));
    assert!(ids.contains(&side_commit.to_string()));
}

#[test]
fn validate_rejects_leading_squash() {
    let (_d, path, base, [a, _b, _c]) = three_commit_topic();
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![plan_step(a, RebaseAction::Squash)],
    };
    let err = begin_rebase(&path, plan).unwrap_err();
    assert!(format!("{err}").contains("squash"));
}

/// A rebase must refuse to start over a dirty working tree, the way git
/// itself does (`cannot rebase: You have unstaged changes`). `detach_to`
/// force-checks-out, so without this guard the uncommitted content is
/// overwritten and is recoverable from nowhere — it never became a git
/// object.
#[test]
fn begin_rebase_refuses_dirty_working_tree() {
    let (_d, path, base, [a, b, c]) = three_commit_topic();
    fs::write(path.join("scratch.txt"), "uncommitted work\n").unwrap();

    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Pick),
            plan_step(c, RebaseAction::Pick),
        ],
    };
    let err = begin_rebase(&path, plan).unwrap_err();

    assert!(
        matches!(err, BackendError::WorkingTreeDirty),
        "expected WorkingTreeDirty, got {err:?}"
    );
    assert_eq!(
        fs::read_to_string(path.join("scratch.txt")).unwrap(),
        "uncommitted work\n",
        "uncommitted work was destroyed"
    );
}

/// A tracked file edited but not committed must survive too — this is the
/// case `detach_to`'s force checkout overwrites via UPDATE_BLOB.
#[test]
fn begin_rebase_refuses_dirty_tracked_file() {
    let (_d, path, base, [a, b, c]) = three_commit_topic();
    fs::write(path.join("a.txt"), "EDITED, NOT COMMITTED\n").unwrap();

    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Pick),
            plan_step(c, RebaseAction::Pick),
        ],
    };
    let err = begin_rebase(&path, plan).unwrap_err();

    assert!(
        matches!(err, BackendError::WorkingTreeDirty),
        "expected WorkingTreeDirty, got {err:?}"
    );
    assert_eq!(
        fs::read_to_string(path.join("a.txt")).unwrap(),
        "EDITED, NOT COMMITTED\n",
        "uncommitted edit to a tracked file was destroyed"
    );
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
