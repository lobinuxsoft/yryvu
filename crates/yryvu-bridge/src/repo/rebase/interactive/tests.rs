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
fn validate_rejects_leading_squash() {
    let (_d, path, base, [a, _b, _c]) = three_commit_topic();
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![plan_step(a, RebaseAction::Squash)],
    };
    let err = begin_rebase(&path, plan).unwrap_err();
    assert!(format!("{err}").contains("squash"));
}
