// SPDX-License-Identifier: AGPL-3.0-or-later

use super::*;
use crate::repo::gitflow::{write_gitflow_config, GitflowConfig};
use git2::{BranchType, Oid, Repository, RepositoryInitOptions, Signature};
use std::path::Path;
use tempfile::TempDir;

fn sig() -> Signature<'static> {
    Signature::now("Test", "test@example.com").unwrap()
}

/// Init a repo with `main` as the default branch and a committer
/// identity configured — `merge_branch` / annotated tags read
/// `user.name` / `user.email` from config.
fn init() -> (TempDir, Repository) {
    let dir = TempDir::new().unwrap();
    let mut opts = RepositoryInitOptions::new();
    opts.initial_head("main");
    let repo = Repository::init_opts(dir.path(), &opts).unwrap();
    let mut config = repo.config().unwrap();
    config.set_str("user.name", "Test").unwrap();
    config.set_str("user.email", "test@example.com").unwrap();
    (dir, repo)
}

/// Commit `content` at `path` on top of HEAD.
fn commit_file(repo: &Repository, path: &str, content: &str, msg: &str) -> Oid {
    std::fs::write(repo.workdir().unwrap().join(path), content).unwrap();
    let mut idx = repo.index().unwrap();
    idx.add_path(Path::new(path)).unwrap();
    idx.write().unwrap();
    let tree = repo.find_tree(idx.write_tree().unwrap()).unwrap();
    let parents: Vec<git2::Commit> = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .into_iter()
        .collect();
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
    repo.commit(Some("HEAD"), &sig(), &sig(), msg, &tree, &parent_refs)
        .unwrap()
}

/// Initial commit on `main`, a `develop` branch off it, and a default
/// gitflow config (`main` / `develop` / standard prefixes).
fn setup(dir: &TempDir, repo: &Repository) {
    commit_file(repo, "README.md", "init", "initial commit");
    let tip = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("develop", &tip, false).unwrap();
    write_gitflow_config(dir.path(), &GitflowConfig::defaults()).unwrap();
}

fn current_branch(repo: &Repository) -> String {
    repo.head().unwrap().shorthand().unwrap().to_string()
}

fn branch_exists(repo: &Repository, name: &str) -> bool {
    repo.find_branch(name, BranchType::Local).is_ok()
}

fn parent_count(repo: &Repository, rev: &str) -> usize {
    repo.revparse_single(rev)
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .parent_count()
}

#[test]
fn feature_start_branches_off_develop_and_checks_out() {
    let (dir, repo) = init();
    setup(&dir, &repo);
    let branch = feature_start(dir.path(), "login").unwrap();
    assert_eq!(branch, "feature/login");
    assert!(branch_exists(&repo, "feature/login"));
    assert_eq!(current_branch(&repo), "feature/login");
}

#[test]
fn feature_finish_no_ff_merges_into_develop_and_deletes() {
    let (dir, repo) = init();
    setup(&dir, &repo);
    feature_start(dir.path(), "login").unwrap();
    commit_file(&repo, "login.rs", "fn login() {}", "add login");

    let outcome = feature_finish(dir.path(), "login", false).unwrap();
    assert_eq!(outcome, FinishOutcome::Completed { tag: None });
    // No-ff: develop's new tip is a merge commit (two parents) even
    // though a fast-forward was possible.
    assert_eq!(parent_count(&repo, "develop"), 2);
    assert!(!branch_exists(&repo, "feature/login"));
    assert_eq!(current_branch(&repo), "develop");
}

#[test]
fn feature_finish_keep_branch_leaves_it() {
    let (dir, repo) = init();
    setup(&dir, &repo);
    feature_start(dir.path(), "x").unwrap();
    commit_file(&repo, "x.txt", "x", "x");
    feature_finish(dir.path(), "x", true).unwrap();
    assert!(branch_exists(&repo, "feature/x"));
}

#[test]
fn release_finish_tags_production_and_merges_both() {
    let (dir, repo) = init();
    setup(&dir, &repo);
    release_start(dir.path(), "1.0.0").unwrap();
    commit_file(&repo, "VERSION", "1.0.0", "bump version");

    let outcome = release_finish(dir.path(), "1.0.0", "Release 1.0.0", false).unwrap();
    assert_eq!(
        outcome,
        FinishOutcome::Completed {
            tag: Some("v1.0.0".to_string())
        }
    );
    // Tag created on production (prefix `v` + version).
    assert!(repo.revparse_single("refs/tags/v1.0.0").is_ok());
    // Both long-lived branches got a merge bubble.
    assert_eq!(parent_count(&repo, "main"), 2);
    assert_eq!(parent_count(&repo, "develop"), 2);
    assert!(!branch_exists(&repo, "release/1.0.0"));
}

#[test]
fn release_finish_empty_message_makes_lightweight_tag() {
    let (dir, repo) = init();
    setup(&dir, &repo);
    release_start(dir.path(), "2.0.0").unwrap();
    commit_file(&repo, "VERSION", "2.0.0", "bump");
    release_finish(dir.path(), "2.0.0", "   ", false).unwrap();
    // Lightweight tags resolve to a commit, not a tag object.
    let obj = repo.revparse_single("refs/tags/v2.0.0").unwrap();
    assert!(obj.as_tag().is_none());
}

#[test]
fn hotfix_start_branches_off_production() {
    let (dir, repo) = init();
    setup(&dir, &repo);
    // Advance develop so it differs from main — confirms hotfix uses
    // main, not develop, as its base.
    feature_start(dir.path(), "ahead").unwrap();
    commit_file(&repo, "ahead.txt", "a", "ahead");
    feature_finish(dir.path(), "ahead", false).unwrap();

    let branch = hotfix_start(dir.path(), "1.0.1").unwrap();
    assert_eq!(branch, "hotfix/1.0.1");
    let main_tip = repo.revparse_single("main").unwrap().id();
    let hotfix_tip = repo.revparse_single("hotfix/1.0.1").unwrap().id();
    assert_eq!(main_tip, hotfix_tip);
}

#[test]
fn hotfix_finish_tags_and_merges_into_both() {
    let (dir, repo) = init();
    setup(&dir, &repo);
    hotfix_start(dir.path(), "1.0.1").unwrap();
    commit_file(&repo, "fix.rs", "// fix", "urgent fix");

    let outcome = hotfix_finish(dir.path(), "1.0.1", "Hotfix 1.0.1", false).unwrap();
    assert_eq!(
        outcome,
        FinishOutcome::Completed {
            tag: Some("v1.0.1".to_string())
        }
    );
    assert!(repo.revparse_single("refs/tags/v1.0.1").is_ok());
    assert_eq!(parent_count(&repo, "main"), 2);
    assert_eq!(parent_count(&repo, "develop"), 2);
    assert!(!branch_exists(&repo, "hotfix/1.0.1"));
}

#[test]
fn github_flow_start_and_finish_round_trip() {
    let (dir, repo) = init();
    // GitHub Flow needs no gitflow config — only a base branch.
    commit_file(&repo, "README.md", "init", "initial commit");

    let branch = github_flow_start(dir.path(), "main", "quick-fix").unwrap();
    assert_eq!(branch, "quick-fix");
    assert_eq!(current_branch(&repo), "quick-fix");
    commit_file(&repo, "patch.txt", "p", "patch");

    let outcome = github_flow_finish(dir.path(), "main", "quick-fix", false).unwrap();
    assert_eq!(outcome, FinishOutcome::Completed { tag: None });
    assert_eq!(parent_count(&repo, "main"), 2);
    assert!(!branch_exists(&repo, "quick-fix"));
    assert_eq!(current_branch(&repo), "main");
}

#[test]
fn ops_require_initialised_gitflow() {
    let (dir, repo) = init();
    commit_file(&repo, "README.md", "init", "initial commit");
    // No write_gitflow_config call.
    assert!(matches!(
        feature_start(dir.path(), "x"),
        Err(GitflowError::NotInitialised)
    ));
    assert!(matches!(
        release_finish(dir.path(), "1.0.0", "", false),
        Err(GitflowError::NotInitialised)
    ));
}
