// SPDX-License-Identifier: AGPL-3.0-or-later

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use crate::backend::BackendError;

use super::*;

fn init_repo() -> (TempDir, PathBuf) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().to_path_buf();
    let mut opts = git2::RepositoryInitOptions::new();
    opts.initial_head("main");
    let repo = git2::Repository::init_opts(&path, &opts).unwrap();
    let mut cfg = repo.config().unwrap();
    cfg.set_str("user.name", "Committer").unwrap();
    cfg.set_str("user.email", "committer@example.com").unwrap();
    cfg.set_str("commit.gpgsign", "false").unwrap();
    (dir, path)
}

fn commit_file_as(
    repo_path: &Path,
    file: &str,
    content: &str,
    message: &str,
    author_name: &str,
    author_email: &str,
) -> git2::Oid {
    fs::write(repo_path.join(file), content).unwrap();
    let repo = git2::Repository::open(repo_path).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new(file)).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let author = git2::Signature::now(author_name, author_email).unwrap();
    let committer = repo.signature().unwrap();
    let parents: Vec<git2::Commit<'_>> = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .into_iter()
        .collect();
    let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
    repo.commit(
        Some("HEAD"),
        &author,
        &committer,
        message,
        &tree,
        &parent_refs,
    )
    .unwrap()
}

fn commit_file(repo_path: &Path, file: &str, content: &str, message: &str) -> git2::Oid {
    commit_file_as(
        repo_path,
        file,
        content,
        message,
        "Committer",
        "committer@example.com",
    )
}

/// `main` carries `base`; `topic` branches off and adds A → B → C on
/// dedicated paths so cherry-picks onto `main` never conflict.
fn three_commit_topic() -> (TempDir, PathBuf, [git2::Oid; 3]) {
    let (dir, path) = init_repo();
    let base = commit_file(&path, "base.txt", "base\n", "base");
    let repo = git2::Repository::open(&path).unwrap();
    repo.branch("topic", &repo.find_commit(base).unwrap(), false)
        .unwrap();
    repo.set_head("refs/heads/topic").unwrap();
    let mut co = git2::build::CheckoutBuilder::new();
    co.force();
    repo.checkout_head(Some(&mut co)).unwrap();
    let a = commit_file_as(
        &path,
        "a.txt",
        "A\n",
        "commit A",
        "Alice",
        "alice@example.com",
    );
    let b = commit_file(&path, "b.txt", "B\n", "commit B");
    let c = commit_file(&path, "c.txt", "C\n", "commit C");
    (dir, path, [a, b, c])
}

fn checkout(path: &Path, branch: &str) {
    super::super::checkout_branch(path, branch).unwrap();
}

fn head_sha(path: &Path) -> git2::Oid {
    let repo = git2::Repository::open(path).unwrap();
    let oid = repo.head().unwrap().peel_to_commit().unwrap().id();
    oid
}

fn head_branch(path: &Path) -> String {
    let repo = git2::Repository::open(path).unwrap();
    let name = repo.head().unwrap().shorthand().unwrap().to_string();
    name
}

#[test]
fn single_onto_current_appends_commit() {
    let (_dir, path, [a, _, _]) = three_commit_topic();
    checkout(&path, "main");
    let before = head_sha(&path);

    cherry_pick_commit(&path, &a.to_string()).unwrap();

    let after = head_sha(&path);
    assert_ne!(before, after, "HEAD should have advanced");
    let repo = git2::Repository::open(&path).unwrap();
    let new = repo.find_commit(after).unwrap();
    assert_eq!(new.message(), Some("commit A"));
    assert_eq!(new.parent_count(), 1);
    assert_eq!(new.parent(0).unwrap().id(), before);
}

#[test]
fn batch_onto_current_preserves_order() {
    let (_dir, path, [a, b, c]) = three_commit_topic();
    checkout(&path, "main");
    let base = head_sha(&path);

    cherry_pick_commits_onto(
        &path,
        &[&a.to_string(), &b.to_string(), &c.to_string()],
        None,
    )
    .unwrap();

    let repo = git2::Repository::open(&path).unwrap();
    let tip = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(tip.message(), Some("commit C"));
    let parent = tip.parent(0).unwrap();
    assert_eq!(parent.message(), Some("commit B"));
    let grand = parent.parent(0).unwrap();
    assert_eq!(grand.message(), Some("commit A"));
    assert_eq!(grand.parent(0).unwrap().id(), base);
}

#[test]
fn onto_target_branch_switches_head() {
    let (_dir, path, [a, _, _]) = three_commit_topic();
    // Currently on topic; ask to cherry-pick A onto main.
    let before = head_branch(&path);
    assert_eq!(before, "topic");

    cherry_pick_commits_onto(&path, &[&a.to_string()], Some("main")).unwrap();

    assert_eq!(head_branch(&path), "main");
    let repo = git2::Repository::open(&path).unwrap();
    let tip = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(tip.message(), Some("commit A"));
}

#[test]
fn onto_same_branch_skips_checkout() {
    let (_dir, path, [a, _, _]) = three_commit_topic();
    checkout(&path, "main");
    // Dirty the tree intentionally: target == current means no checkout
    // is attempted, so the dirty state is irrelevant for the pre-flight.
    fs::write(path.join("scratch.txt"), "wip\n").unwrap();
    cherry_pick_commits_onto(&path, &[&a.to_string()], Some("main")).unwrap();

    let repo = git2::Repository::open(&path).unwrap();
    let tip = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(tip.message(), Some("commit A"));
    assert_eq!(head_branch(&path), "main");
}

#[test]
fn dirty_tree_blocks_switching_target() {
    let (_dir, path, [a, _, _]) = three_commit_topic();
    fs::write(path.join("dirty.txt"), "uncommitted\n").unwrap();

    let err = cherry_pick_commits_onto(&path, &[&a.to_string()], Some("main")).unwrap_err();
    assert!(matches!(err, BackendError::WorkingTreeDirty));
    assert_eq!(head_branch(&path), "topic", "HEAD must be unchanged");
}

#[test]
fn missing_target_branch_returns_branch_not_found() {
    let (_dir, path, [a, _, _]) = three_commit_topic();
    let err = cherry_pick_commits_onto(&path, &[&a.to_string()], Some("nope")).unwrap_err();
    assert!(matches!(err, BackendError::BranchNotFound { .. }));
}

#[test]
fn preserves_author_distinct_from_committer() {
    let (_dir, path, [a, _, _]) = three_commit_topic();
    checkout(&path, "main");
    cherry_pick_commits_onto(&path, &[&a.to_string()], None).unwrap();

    let repo = git2::Repository::open(&path).unwrap();
    let tip = repo.head().unwrap().peel_to_commit().unwrap();
    let author = tip.author();
    let committer = tip.committer();
    assert_eq!(author.email(), Some("alice@example.com"));
    assert_eq!(author.name(), Some("Alice"));
    assert_eq!(committer.email(), Some("committer@example.com"));
    assert_eq!(committer.name(), Some("Committer"));
}

#[test]
fn empty_batch_is_noop() {
    let (_dir, path, _) = three_commit_topic();
    let before = head_sha(&path);
    cherry_pick_commits_onto(&path, &[], Some("main")).unwrap();
    assert_eq!(head_sha(&path), before, "no checkout, no commit");
}

#[test]
fn conflict_midway_keeps_earlier_picks() {
    // Build a divergent history so the second pick conflicts on the same
    // path. `main` writes "main side", topic writes "A then B" on the same
    // file. Cherry-pick [A, B] onto main → A applies clean (different
    // file), B conflicts (same path as main's content if we arrange it).
    let (_dir, path) = init_repo();
    commit_file(&path, "base.txt", "base\n", "base");
    // topic branch + two commits
    let repo = git2::Repository::open(&path).unwrap();
    let base_oid = repo.head().unwrap().peel_to_commit().unwrap().id();
    repo.branch("topic", &repo.find_commit(base_oid).unwrap(), false)
        .unwrap();
    repo.set_head("refs/heads/topic").unwrap();
    let mut co = git2::build::CheckoutBuilder::new();
    co.force();
    repo.checkout_head(Some(&mut co)).unwrap();
    let a = commit_file(&path, "side.txt", "topicA\n", "commit A");
    let b = commit_file(&path, "shared.txt", "topicB\n", "commit B");

    // main writes a divergent value at the same `shared.txt` so cherry-
    // picking B onto main conflicts.
    super::super::checkout_branch(&path, "main").unwrap();
    commit_file(&path, "shared.txt", "mainline\n", "main divergence");

    let main_before = head_sha(&path);
    let err = cherry_pick_commits_onto(&path, &[&a.to_string(), &b.to_string()], None).unwrap_err();
    assert!(matches!(err, BackendError::MergeConflict { .. }));

    // A applied cleanly → HEAD moved one commit forward of `main_before`.
    let after = head_sha(&path);
    assert_ne!(after, main_before, "A should have landed before B failed");
    let repo = git2::Repository::open(&path).unwrap();
    let tip = repo.find_commit(after).unwrap();
    assert_eq!(tip.message(), Some("commit A"));
    // CHERRY_PICK_HEAD must still be set so the StateBanner picks it up.
    assert!(repo.state() == git2::RepositoryState::CherryPick);
}
