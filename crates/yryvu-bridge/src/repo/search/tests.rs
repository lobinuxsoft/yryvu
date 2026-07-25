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

fn build_seed_repo() -> (TempDir, PathBuf) {
    let (dir, path) = init_repo();
    commit_file(&path, "alpha.txt", "alpha\n", "feat: add alpha module");
    commit_file(&path, "beta.txt", "beta\n", "fix: beta off-by-one");
    commit_file(&path, "gamma.md", "gamma\n", "docs: gamma reference");
    let repo = git2::Repository::open(&path).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("topic/feature", &head, false).unwrap();
    repo.branch("release/1.0", &head, false).unwrap();
    repo.tag_lightweight("v1.0.0", head.as_object(), false)
        .unwrap();
    (dir, path)
}

#[test]
fn build_index_returns_counts_per_mode() {
    cache_reset();
    let (_d, path) = build_seed_repo();
    let counts = build_index(&path).unwrap();
    assert_eq!(counts.commits, 3);
    assert_eq!(counts.files, 3);
    // master/main + topic + release.
    assert!(counts.branches >= 3, "branches = {}", counts.branches);
    assert_eq!(counts.tags, 1);
    assert_eq!(counts.stashes, 0);
}

#[test]
fn search_commits_exact_match_tops_results() {
    cache_reset();
    let (_d, path) = build_seed_repo();
    build_index(&path).unwrap();
    let hits = search(&path, SearchMode::Commits, "alpha", None).unwrap();
    assert!(!hits.is_empty());
    assert!(
        hits[0].label.contains("alpha"),
        "top hit = {:?}",
        hits[0].label
    );
}

#[test]
fn search_files_matches_path() {
    cache_reset();
    let (_d, path) = build_seed_repo();
    build_index(&path).unwrap();
    let hits = search(&path, SearchMode::Files, "gamma", None).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].label, "gamma.md");
}

#[test]
fn search_branches_matches_topic() {
    cache_reset();
    let (_d, path) = build_seed_repo();
    build_index(&path).unwrap();
    let hits = search(&path, SearchMode::Branches, "topic", None).unwrap();
    assert!(hits.iter().any(|h| h.label.contains("topic/feature")));
}

#[test]
fn search_tags_matches_version() {
    cache_reset();
    let (_d, path) = build_seed_repo();
    build_index(&path).unwrap();
    let hits = search(&path, SearchMode::Tags, "v1", None).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].label, "v1.0.0");
}

#[test]
fn empty_query_returns_recents_capped_by_limit() {
    cache_reset();
    let (_d, path) = build_seed_repo();
    build_index(&path).unwrap();
    let hits = search(&path, SearchMode::Commits, "  ", Some(2)).unwrap();
    assert_eq!(hits.len(), 2);
}

#[test]
fn search_no_match_returns_empty() {
    cache_reset();
    let (_d, path) = build_seed_repo();
    build_index(&path).unwrap();
    let hits = search(&path, SearchMode::Commits, "zzzz_no_such_thing", None).unwrap();
    assert!(hits.is_empty());
}
