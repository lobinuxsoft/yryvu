// SPDX-License-Identifier: AGPL-3.0-or-later

//! Interactive-rebase tests, grouped by concern:
//!
//! - [`actions`] — plan transformations (pick/reword/squash/fixup/drop,
//!   commit listing).
//! - [`pause_resume`] — edit/conflict pauses and continue/skip/abort.
//! - [`guards`] — plan validation and the dirty-tree refusal.
//!
//! The shared repo-fixture helpers live here so all three submodules can
//! reach them.

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::*;

mod actions;
mod guards;
mod pause_resume;

pub(super) fn init_repo() -> (TempDir, PathBuf) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().to_path_buf();
    let repo = git2::Repository::init(&path).unwrap();
    let mut cfg = repo.config().unwrap();
    cfg.set_str("user.name", "Test").unwrap();
    cfg.set_str("user.email", "test@example.com").unwrap();
    cfg.set_str("commit.gpgsign", "false").unwrap();
    (dir, path)
}

pub(super) fn commit_file(repo_path: &Path, file: &str, content: &str, message: &str) -> git2::Oid {
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
pub(super) fn three_commit_topic() -> (TempDir, PathBuf, git2::Oid, [git2::Oid; 3]) {
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

pub(super) fn head_oid(repo_path: &Path) -> git2::Oid {
    let repo = git2::Repository::open(repo_path).unwrap();
    let head = repo.head().unwrap();
    let commit = head.peel_to_commit().unwrap();
    commit.id()
}

pub(super) fn head_message(repo_path: &Path) -> String {
    let repo = git2::Repository::open(repo_path).unwrap();
    let head = repo.head().unwrap();
    let commit = head.peel_to_commit().unwrap();
    commit.message().unwrap_or("").to_string()
}

pub(super) fn commits_since(repo_path: &Path, base: git2::Oid) -> Vec<git2::Oid> {
    let repo = git2::Repository::open(repo_path).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap().id();
    let mut rw = repo.revwalk().unwrap();
    rw.push(head).unwrap();
    rw.hide(base).unwrap();
    rw.map(|r| r.unwrap()).collect()
}

pub(super) fn plan_step(oid: git2::Oid, action: RebaseAction) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action,
        new_message: None,
    }
}
