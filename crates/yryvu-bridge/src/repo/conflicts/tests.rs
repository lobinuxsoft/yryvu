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

/// Build a repo where the default branch and `topic` both edit line 2 of
/// `shared.txt` differently. `repo.merge` is invoked so the index ends
/// up with the three stages populated.
fn merge_with_conflict() -> (TempDir, PathBuf) {
    let (dir, path) = init_repo();
    let base = commit_file(&path, "shared.txt", "1\nbase\n3\n", "base");
    let repo = git2::Repository::open(&path).unwrap();
    repo.branch("topic", &repo.find_commit(base).unwrap(), false)
        .unwrap();
    // Diverge the default branch.
    commit_file(&path, "shared.txt", "1\nours\n3\n", "ours");
    // Diverge topic.
    repo.set_head("refs/heads/topic").unwrap();
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).unwrap();
    let topic_tip = commit_file(&path, "shared.txt", "1\ntheirs\n3\n", "theirs");
    // Back to the default branch and merge — produces the conflict.
    repo.set_head("refs/heads/master")
        .or_else(|_| repo.set_head("refs/heads/main"))
        .unwrap();
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).unwrap();
    let topic_annotated = repo.find_annotated_commit(topic_tip).unwrap();
    repo.merge(&[&topic_annotated], None, None).unwrap();
    (dir, path)
}

#[test]
fn detects_conflict_markers() {
    assert!(detect_conflict_markers(
        "<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>> branch\n"
    ));
    assert!(!detect_conflict_markers("just a normal\nfile\n"));
    assert!(detect_conflict_markers("|||||||\nbase\n=======\n"));
}

#[test]
fn list_reports_merge_source_and_path() {
    let (_d, path) = merge_with_conflict();
    let listing = list_conflicts(&path).unwrap();
    assert_eq!(listing.source, ConflictSource::Merge);
    assert_eq!(listing.files.len(), 1);
    assert_eq!(listing.files[0].path, "shared.txt");
    assert!(listing.files[0].has_ancestor);
    assert!(listing.files[0].has_ours);
    assert!(listing.files[0].has_theirs);
}

#[test]
fn read_diff3_returns_three_sides() {
    let (_d, path) = merge_with_conflict();
    let diff3 = read_diff3(&path, "shared.txt").unwrap();
    assert_eq!(diff3.base.as_deref(), Some("1\nbase\n3\n"));
    assert_eq!(diff3.ours.as_deref(), Some("1\nours\n3\n"));
    assert_eq!(diff3.theirs.as_deref(), Some("1\ntheirs\n3\n"));
    assert!(diff3.working.contains("<<<<<<<"));
}

#[test]
fn accept_side_ours_writes_workdir_and_index() {
    let (_d, path) = merge_with_conflict();
    accept_side(&path, "shared.txt", ConflictSide::Ours).unwrap();
    assert_eq!(
        fs::read_to_string(path.join("shared.txt")).unwrap(),
        "1\nours\n3\n"
    );
    let listing = list_conflicts(&path).unwrap();
    assert_eq!(listing.files.len(), 0, "stages 1/2/3 should be cleared");
}

#[test]
fn accept_side_theirs_writes_theirs() {
    let (_d, path) = merge_with_conflict();
    accept_side(&path, "shared.txt", ConflictSide::Theirs).unwrap();
    assert_eq!(
        fs::read_to_string(path.join("shared.txt")).unwrap(),
        "1\ntheirs\n3\n"
    );
}

#[test]
fn resolve_with_content_writes_arbitrary_blob() {
    let (_d, path) = merge_with_conflict();
    resolve_with_content(&path, "shared.txt", "1\nmerged\n3\n").unwrap();
    assert_eq!(
        fs::read_to_string(path.join("shared.txt")).unwrap(),
        "1\nmerged\n3\n"
    );
    let listing = list_conflicts(&path).unwrap();
    assert_eq!(listing.files.len(), 0);
}

#[test]
fn mark_resolved_refuses_lingering_markers() {
    let (_d, path) = merge_with_conflict();
    let err = mark_resolved(&path, "shared.txt").unwrap_err();
    assert!(format!("{err}").contains("conflict markers still present"));
}

#[test]
fn mark_resolved_accepts_clean_worktree() {
    let (_d, path) = merge_with_conflict();
    fs::write(path.join("shared.txt"), "1\nresolved\n3\n").unwrap();
    mark_resolved(&path, "shared.txt").unwrap();
    let listing = list_conflicts(&path).unwrap();
    assert_eq!(listing.files.len(), 0);
}

#[test]
fn finish_merge_commits_and_clears_state() {
    let (_d, path) = merge_with_conflict();
    resolve_with_content(&path, "shared.txt", "1\nresolved\n3\n").unwrap();
    let source = finish_in_progress(&path).unwrap();
    assert_eq!(source, ConflictSource::Merge);
    let repo = git2::Repository::open(&path).unwrap();
    assert_eq!(repo.state(), git2::RepositoryState::Clean);
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.parent_count(), 2, "merge should have two parents");
}

#[test]
fn finish_refuses_with_unresolved_files() {
    let (_d, path) = merge_with_conflict();
    let err = finish_in_progress(&path).unwrap_err();
    assert!(format!("{err}").contains("unresolved"));
}
