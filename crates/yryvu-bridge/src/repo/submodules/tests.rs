// SPDX-License-Identifier: AGPL-3.0-or-later

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

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

/// git >= 2.38 blocks the file transport for `git submodule` clone
/// subprocesses (CVE-2022-39253), and repo-local config doesn't reach
/// the spawned `git clone`. Tests that exercise the shell-out add
/// path inject the override through the environment, which every git
/// child process reads.
fn allow_file_protocol() {
    std::env::set_var("GIT_CONFIG_COUNT", "1");
    std::env::set_var("GIT_CONFIG_KEY_0", "protocol.file.allow");
    std::env::set_var("GIT_CONFIG_VALUE_0", "always");
}

fn commit_file(repo_path: &Path, file: &str, content: &str, message: &str) -> git2::Oid {
    fs::write(repo_path.join(file), content).unwrap();
    let repo = git2::Repository::open(repo_path).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new(file)).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = repo.signature().unwrap();
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

/// Parent repo with one committed submodule at `sub/` (named "sub"),
/// pinned to the child's single commit. Returns (parent guard, parent
/// path, child guard, child path).
fn parent_with_submodule() -> (TempDir, PathBuf, TempDir, PathBuf) {
    let (child_dir, child_path) = init_repo();
    commit_file(&child_path, "lib.txt", "v1", "child: initial");
    let (parent_dir, parent_path) = init_repo();
    commit_file(&parent_path, "README.md", "parent", "parent: initial");

    submodule_add(
        &parent_path,
        child_path.to_str().unwrap(),
        Path::new("sub"),
        None,
        None,
    )
    .unwrap();
    // submodule_add stages .gitmodules + the gitlink; commit them so
    // head_sha (the parent-pinned commit) resolves in list_submodules.
    let repo = git2::Repository::open(&parent_path).unwrap();
    let mut index = repo.index().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = repo.signature().unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        "parent: add submodule",
        &tree,
        &[&head],
    )
    .unwrap();
    (parent_dir, parent_path, child_dir, child_path)
}

fn find_sub(repo_path: &Path, name: &str) -> SubmoduleInfo {
    list_submodules(repo_path)
        .unwrap()
        .into_iter()
        .find(|s| s.name == name)
        .expect("submodule row present")
}

#[test]
fn list_reports_clean_initialized_submodule() {
    let (_pg, parent, _cg, _child) = parent_with_submodule();
    let sub = find_sub(&parent, "sub");
    assert!(sub.is_initialized);
    assert!(!sub.is_deleted);
    assert!(!sub.is_dirty);
    assert_eq!(sub.ahead, 0);
    assert_eq!(sub.behind, 0);
    assert!(sub.head_sha.is_some());
}

#[test]
fn dirty_working_tree_sets_is_dirty() {
    let (_pg, parent, _cg, _child) = parent_with_submodule();
    fs::write(parent.join("sub/untracked.txt"), "wip").unwrap();
    assert!(find_sub(&parent, "sub").is_dirty);

    fs::remove_file(parent.join("sub/untracked.txt")).unwrap();
    assert!(!find_sub(&parent, "sub").is_dirty);

    fs::write(parent.join("sub/lib.txt"), "modified tracked").unwrap();
    assert!(find_sub(&parent, "sub").is_dirty);
}

#[test]
fn reset_discards_changes_and_repins() {
    let (_pg, parent, _cg, _child) = parent_with_submodule();
    let pinned = find_sub(&parent, "sub").head_sha.unwrap();

    // Move the inner HEAD ahead of the pin + dirty the tree.
    let inner_path = parent.join("sub");
    commit_file(&inner_path, "extra.txt", "x", "inner: ahead of pin");
    fs::write(inner_path.join("lib.txt"), "dirty").unwrap();
    let before = find_sub(&parent, "sub");
    assert!(before.ahead > 0);
    assert!(before.is_dirty);

    submodule_reset(&parent, "sub").unwrap();

    let after = find_sub(&parent, "sub");
    assert_eq!(after.ahead, 0);
    assert!(!after.is_dirty);
    let inner = git2::Repository::open(&inner_path).unwrap();
    let inner_head = inner.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(inner_head.id().to_string(), pinned);
    assert_eq!(
        fs::read_to_string(inner_path.join("lib.txt")).unwrap(),
        "v1"
    );
}

#[test]
fn sync_copies_gitmodules_url_into_config() {
    let (_pg, parent, _cg, child) = parent_with_submodule();

    // Point .gitmodules at a new URL, then sync.
    let new_url = format!("{}-moved", child.to_str().unwrap());
    let gitmodules = parent.join(".gitmodules");
    let rewritten = fs::read_to_string(&gitmodules)
        .unwrap()
        .replace(child.to_str().unwrap(), &new_url);
    fs::write(&gitmodules, rewritten).unwrap();

    submodule_sync(&parent, "sub").unwrap();

    let repo = git2::Repository::open(&parent).unwrap();
    let cfg = repo.config().unwrap();
    assert_eq!(cfg.get_string("submodule.sub.url").unwrap(), new_url);
}

#[test]
fn deinit_unregisters_but_keeps_gitmodules_entry() {
    let (_pg, parent, _cg, _child) = parent_with_submodule();

    submodule_deinit(&parent, "sub").unwrap();

    let sub = find_sub(&parent, "sub");
    assert!(!sub.is_initialized);
    assert!(!sub.is_dirty);
    // .gitmodules entry survives — deinit only unregisters.
    let gitmodules = fs::read_to_string(parent.join(".gitmodules")).unwrap();
    assert!(gitmodules.contains("[submodule \"sub\"]"));
    // Re-init is cheap and restores the working tree.
    submodule_init(&parent, "sub").unwrap();
    assert!(find_sub(&parent, "sub").is_initialized);
}

#[test]
fn add_with_custom_name_and_branch_records_both() {
    allow_file_protocol();
    let (child_dir, child_path) = init_repo();
    commit_file(&child_path, "lib.txt", "v1", "child: initial");
    let (_pg, parent) = init_repo();
    commit_file(&parent, "README.md", "parent", "parent: initial");

    submodule_add(
        &parent,
        child_path.to_str().unwrap(),
        Path::new("vendor/dep"),
        Some("main"),
        Some("custom-name"),
    )
    .unwrap();
    drop(child_dir);

    let gitmodules = fs::read_to_string(parent.join(".gitmodules")).unwrap();
    assert!(gitmodules.contains("[submodule \"custom-name\"]"));
    assert!(gitmodules.contains("branch = main"));
    let sub = find_sub(&parent, "custom-name");
    assert_eq!(sub.path, "vendor/dep");
    assert!(sub.is_initialized);
}
