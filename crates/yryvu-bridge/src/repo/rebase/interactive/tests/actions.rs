// SPDX-License-Identifier: AGPL-3.0-or-later

//! Plan transformations: commit listing, pick/reorder, reword, squash,
//! fixup, drop.

use super::*;

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
