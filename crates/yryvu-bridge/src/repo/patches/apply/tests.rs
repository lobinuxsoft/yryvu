// SPDX-License-Identifier: AGPL-3.0-or-later

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use crate::backend::BackendError;
use crate::repo::patches::format_patch;

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

/// Commit `file`=`content` with a fixed-time author so the round-trip can
/// assert the exact author date survives.
fn commit_with_author(
    repo_path: &Path,
    file: &str,
    content: &str,
    message: &str,
    author: &git2::Signature<'_>,
) -> git2::Oid {
    fs::write(repo_path.join(file), content).unwrap();
    let repo = git2::Repository::open(repo_path).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new(file)).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
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
        author,
        &committer,
        message,
        &tree,
        &parent_refs,
    )
    .unwrap()
}

fn reset_hard(repo_path: &Path, target: git2::Oid) {
    let repo = git2::Repository::open(repo_path).unwrap();
    let obj = repo.find_object(target, None).unwrap();
    repo.reset(&obj, git2::ResetType::Hard, None).unwrap();
}

fn head_oid(repo_path: &Path) -> git2::Oid {
    git2::Repository::open(repo_path)
        .unwrap()
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
}

/// format-patch a commit, roll the branch back to its parent, then
/// apply-patch it: the rebuilt commit must have the SAME tree hash and the
/// author identity/date preserved, with the committer stamped separately.
#[test]
fn round_trip_preserves_tree_author_and_message() {
    let (_dir, path) = init_repo();
    let base = commit_with_author(
        &path,
        "widget.rs",
        "// widget\n",
        "base",
        &git2::Signature::now("Committer", "committer@example.com").unwrap(),
    );

    let author = git2::Signature::new(
        "Ada Lovelace",
        "ada@example.com",
        &git2::Time::new(1_700_000_000, 0),
    )
    .unwrap();
    let msg = "feat: add widget\n\nLonger explanation.\nSecond line.";
    let topic = commit_with_author(&path, "widget.rs", "// widget\n// added\n", msg, &author);
    let topic_tree = git2::Repository::open(&path)
        .unwrap()
        .find_commit(topic)
        .unwrap()
        .tree_id();

    let out = TempDir::new().unwrap();
    let patch = format_patch(&path, &topic.to_string(), out.path()).unwrap();

    // Roll back to the parent so the patch applies onto the same base tree.
    reset_hard(&path, base);

    let outcome = apply_patch(
        &path,
        Path::new(&patch),
        Some(("Grace Hopper", "grace@example.com")),
    )
    .unwrap();

    assert_eq!(outcome.subject, "feat: add widget");
    let repo = git2::Repository::open(&path).unwrap();
    let new = repo.find_commit(head_oid(&path)).unwrap();

    assert_eq!(new.tree_id(), topic_tree, "tree hash must round-trip");
    assert_eq!(new.author().name(), Some("Ada Lovelace"));
    assert_eq!(new.author().email(), Some("ada@example.com"));
    assert_eq!(new.author().when().seconds(), 1_700_000_000);
    assert_eq!(new.author().when().offset_minutes(), 0);
    assert_eq!(new.committer().name(), Some("Grace Hopper"));
    assert_eq!(new.message().unwrap().trim(), msg);
    assert_eq!(new.parent(0).unwrap().id(), base);
}

/// Committer falls back to the repo signature when no profile identity is
/// supplied.
#[test]
fn committer_defaults_to_repo_signature() {
    let (_dir, path) = init_repo();
    let base = commit_with_author(
        &path,
        "a.txt",
        "one\n",
        "base",
        &git2::Signature::now("C", "c@example.com").unwrap(),
    );
    let author =
        git2::Signature::new("Ada", "ada@example.com", &git2::Time::new(1_700_000_000, 0)).unwrap();
    let topic = commit_with_author(&path, "a.txt", "one\ntwo\n", "add two", &author);
    let out = TempDir::new().unwrap();
    let patch = format_patch(&path, &topic.to_string(), out.path()).unwrap();
    reset_hard(&path, base);

    apply_patch(&path, Path::new(&patch), None).unwrap();

    let repo = git2::Repository::open(&path).unwrap();
    let new = repo.find_commit(head_oid(&path)).unwrap();
    assert_eq!(new.committer().name(), Some("Committer"));
    assert_eq!(new.committer().email(), Some("committer@example.com"));
}

#[test]
fn malformed_patch_is_rejected_without_touching_the_repo() {
    let (_dir, path) = init_repo();
    commit_with_author(
        &path,
        "a.txt",
        "one\n",
        "base",
        &git2::Signature::now("C", "c@example.com").unwrap(),
    );
    let before = head_oid(&path);

    let bad = TempDir::new().unwrap();
    let bad_patch = bad.path().join("bad.patch");
    fs::write(&bad_patch, "not an mbox at all\n\njust text\n").unwrap();

    let err = apply_patch(&path, &bad_patch, None).unwrap_err();
    assert!(matches!(err, BackendError::PatchParse { .. }));
    assert_eq!(head_oid(&path), before, "repo must be untouched");
}

#[test]
fn non_applying_patch_leaves_repo_pristine() {
    let (_dir, path) = init_repo();
    let base = commit_with_author(
        &path,
        "a.txt",
        "one\n",
        "base",
        &git2::Signature::now("C", "c@example.com").unwrap(),
    );
    let author =
        git2::Signature::new("Ada", "ada@example.com", &git2::Time::new(1_700_000_000, 0)).unwrap();
    let topic = commit_with_author(&path, "a.txt", "one\ntwo\n", "add two", &author);
    let out = TempDir::new().unwrap();
    let patch = format_patch(&path, &topic.to_string(), out.path()).unwrap();

    // Roll back to base then diverge the same file so the patch context
    // no longer matches.
    reset_hard(&path, base);
    commit_with_author(
        &path,
        "a.txt",
        "completely different\n",
        "diverge",
        &git2::Signature::now("C", "c@example.com").unwrap(),
    );
    let before = head_oid(&path);

    let err = apply_patch(&path, Path::new(&patch), None).unwrap_err();
    assert!(matches!(err, BackendError::PatchDoesNotApply));
    assert_eq!(head_oid(&path), before, "failed apply must not commit");
    assert_eq!(
        fs::read_to_string(path.join("a.txt")).unwrap(),
        "completely different\n",
        "working tree must be untouched",
    );
}

#[test]
fn strip_patch_prefix_tolerates_versioned_tags() {
    assert_eq!(strip_patch_prefix("[PATCH] feat: x"), "feat: x");
    assert_eq!(strip_patch_prefix("[PATCH v2 3/5] fix: y"), "fix: y");
    assert_eq!(strip_patch_prefix("no tag here"), "no tag here");
}

#[test]
fn parse_from_extracts_name_and_email() {
    assert_eq!(
        parse_from("Ada Lovelace <ada@example.com>").unwrap(),
        ("Ada Lovelace".to_string(), "ada@example.com".to_string())
    );
    assert_eq!(
        parse_from("bare@example.com").unwrap(),
        (String::new(), "bare@example.com".to_string())
    );
    assert!(parse_from("no email").is_err());
}

#[test]
fn parse_date_round_trips_the_emitter_format() {
    // `%-d` single-digit day is what format_patch emits.
    let t = parse_date("Sat, 4 Jul 2026 12:30:00 +0000").unwrap();
    assert_eq!(t.offset_minutes(), 0);
    // And strict RFC-2822 (two-digit day, tz offset).
    let t2 = parse_date("Tue, 14 Nov 2023 22:13:20 +0200").unwrap();
    assert_eq!(t2.offset_minutes(), 120);
}
