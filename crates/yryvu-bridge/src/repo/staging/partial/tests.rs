// SPDX-License-Identifier: AGPL-3.0-or-later

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::*;
use crate::backend::LineKind;

fn init_repo() -> (TempDir, PathBuf) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().to_path_buf();
    let repo = git2::Repository::init(&path).unwrap();
    let mut cfg = repo.config().unwrap();
    cfg.set_str("user.name", "Test").unwrap();
    cfg.set_str("user.email", "test@example.com").unwrap();
    (dir, path)
}

fn commit_initial(repo_path: &Path, files: &[(&str, &str)]) -> git2::Oid {
    let repo = git2::Repository::open(repo_path).unwrap();
    for (name, content) in files {
        fs::write(repo_path.join(name), content).unwrap();
    }
    let mut index = repo.index().unwrap();
    for (name, _) in files {
        index.add_path(Path::new(name)).unwrap();
    }
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = git2::Signature::now("Test", "test@example.com").unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
        .unwrap()
}

fn read_index_blob(repo_path: &Path, file: &str) -> String {
    let repo = git2::Repository::open(repo_path).unwrap();
    let index = repo.index().unwrap();
    let entry = index.get_path(Path::new(file), 0).unwrap();
    let blob = repo.find_blob(entry.id).unwrap();
    String::from_utf8(blob.content().to_vec()).unwrap()
}

const INITIAL_14: &str = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n";
const EDITED_14: &str = "1\n2\n3X\n4\n5\n6\n7\n8\n9\n10\n11\n12Y\n13\n14\n";

#[test]
fn stage_hunk_writes_selected_hunk_to_index() {
    let (_dir, path) = init_repo();
    commit_initial(&path, &[("a.txt", INITIAL_14)]);
    fs::write(path.join("a.txt"), EDITED_14).unwrap();

    let file = current_file_diff(&path, "a.txt", DiffSource::WorkdirVsIndex).unwrap();
    assert_eq!(
        file.hunks.len(),
        2,
        "expected two hunks, got {:#?}",
        file.hunks
    );

    stage_hunks(&path, "a.txt", &[0]).unwrap();
    let indexed = read_index_blob(&path, "a.txt");
    assert!(indexed.contains("3X"), "first hunk should be staged");
    assert!(!indexed.contains("12Y"), "second hunk should NOT be staged");
}

#[test]
fn stage_lines_drops_unselected_additions() {
    let (_dir, path) = init_repo();
    commit_initial(&path, &[("a.txt", "a\nb\nc\n")]);
    fs::write(path.join("a.txt"), "a\nX\nY\nb\nc\n").unwrap();

    let file = current_file_diff(&path, "a.txt", DiffSource::WorkdirVsIndex).unwrap();
    let add_indices: Vec<u32> = file.hunks[0]
        .lines
        .iter()
        .enumerate()
        .filter(|(_, l)| matches!(l.kind, LineKind::Added))
        .map(|(i, _)| i as u32)
        .collect();
    assert_eq!(add_indices.len(), 2);

    stage_lines(
        &path,
        "a.txt",
        &[LineRange {
            hunk_index: 0,
            line_indices: vec![add_indices[0]],
        }],
    )
    .unwrap();

    let indexed = read_index_blob(&path, "a.txt");
    assert!(indexed.contains("X"), "selected line should be staged");
    assert!(
        !indexed.contains("Y"),
        "unselected line should NOT be staged"
    );
}

#[test]
fn unstage_hunk_resets_one_hunk_in_index() {
    let (_dir, path) = init_repo();
    commit_initial(&path, &[("a.txt", INITIAL_14)]);
    fs::write(path.join("a.txt"), EDITED_14).unwrap();
    let repo = git2::Repository::open(&path).unwrap();
    let mut idx = repo.index().unwrap();
    idx.add_path(Path::new("a.txt")).unwrap();
    idx.write().unwrap();
    drop(idx);

    let staged = current_file_diff(&path, "a.txt", DiffSource::IndexVsHead).unwrap();
    assert_eq!(staged.hunks.len(), 2, "expected two staged hunks");
    unstage_hunks(&path, "a.txt", &[0]).unwrap();

    let indexed = read_index_blob(&path, "a.txt");
    assert!(!indexed.contains("3X"), "first hunk should be unstaged");
    assert!(indexed.contains("12Y"), "second hunk should remain staged");
}

#[test]
fn discard_hunk_reverts_workdir_only() {
    let (_dir, path) = init_repo();
    commit_initial(&path, &[("a.txt", INITIAL_14)]);
    fs::write(path.join("a.txt"), EDITED_14).unwrap();

    discard_hunks(&path, "a.txt", &[1]).unwrap();

    let workdir = fs::read_to_string(path.join("a.txt")).unwrap();
    assert!(
        workdir.contains("3X"),
        "first hunk should remain in workdir"
    );
    assert!(!workdir.contains("12Y"), "second hunk should be discarded");

    let indexed = read_index_blob(&path, "a.txt");
    assert!(!indexed.contains("3X"));
    assert!(!indexed.contains("12Y"));
}

#[test]
fn discard_line_reverts_a_single_addition() {
    let (_dir, path) = init_repo();
    commit_initial(&path, &[("a.txt", "a\nb\nc\n")]);
    fs::write(path.join("a.txt"), "a\nX\nY\nb\nc\n").unwrap();

    let file = current_file_diff(&path, "a.txt", DiffSource::WorkdirVsIndex).unwrap();
    let add_indices: Vec<u32> = file.hunks[0]
        .lines
        .iter()
        .enumerate()
        .filter(|(_, l)| matches!(l.kind, LineKind::Added))
        .map(|(i, _)| i as u32)
        .collect();
    discard_lines(
        &path,
        "a.txt",
        &[LineRange {
            hunk_index: 0,
            line_indices: vec![add_indices[0]],
        }],
    )
    .unwrap();

    let workdir = fs::read_to_string(path.join("a.txt")).unwrap();
    assert_eq!(workdir, "a\nY\nb\nc\n", "only X should be discarded");
}

#[test]
fn stage_multiple_hunks_in_one_call() {
    let (_dir, path) = init_repo();
    commit_initial(&path, &[("a.txt", INITIAL_14)]);
    fs::write(path.join("a.txt"), EDITED_14).unwrap();

    stage_hunks(&path, "a.txt", &[0, 1]).unwrap();
    let indexed = read_index_blob(&path, "a.txt");
    assert!(indexed.contains("3X"));
    assert!(indexed.contains("12Y"));
}

#[test]
fn stage_hunk_for_untracked_file_adds_to_index() {
    let (_dir, path) = init_repo();
    commit_initial(&path, &[("seed.txt", "seed\n")]);
    fs::write(path.join("new.txt"), "alpha\nbeta\ngamma\n").unwrap();

    stage_hunks(&path, "new.txt", &[0]).unwrap();

    let indexed = read_index_blob(&path, "new.txt");
    assert_eq!(indexed, "alpha\nbeta\ngamma\n");
}

#[test]
fn unstage_line_keeps_other_staged_changes() {
    let (_dir, path) = init_repo();
    commit_initial(&path, &[("a.txt", "a\nb\nc\n")]);
    fs::write(path.join("a.txt"), "a\nX\nY\nb\nc\n").unwrap();
    let repo = git2::Repository::open(&path).unwrap();
    let mut idx = repo.index().unwrap();
    idx.add_path(Path::new("a.txt")).unwrap();
    idx.write().unwrap();
    drop(idx);

    let staged = current_file_diff(&path, "a.txt", DiffSource::IndexVsHead).unwrap();
    let add_indices: Vec<u32> = staged.hunks[0]
        .lines
        .iter()
        .enumerate()
        .filter(|(_, l)| matches!(l.kind, LineKind::Added))
        .map(|(i, _)| i as u32)
        .collect();

    unstage_lines(
        &path,
        "a.txt",
        &[LineRange {
            hunk_index: 0,
            line_indices: vec![add_indices[0]],
        }],
    )
    .unwrap();

    let indexed = read_index_blob(&path, "a.txt");
    assert_eq!(indexed, "a\nY\nb\nc\n", "X unstaged, Y still staged");
}

#[test]
fn discard_hunk_for_deleted_file_restores_workdir() {
    let (_dir, path) = init_repo();
    commit_initial(&path, &[("gone.txt", "alpha\nbeta\n")]);
    fs::remove_file(path.join("gone.txt")).unwrap();

    discard_hunks(&path, "gone.txt", &[0]).unwrap();

    assert!(path.join("gone.txt").exists(), "file should be restored");
    let workdir = fs::read_to_string(path.join("gone.txt")).unwrap();
    assert_eq!(workdir, "alpha\nbeta\n");
}

#[test]
fn empty_selection_is_a_noop() {
    let (_dir, path) = init_repo();
    commit_initial(&path, &[("a.txt", "a\n")]);
    fs::write(path.join("a.txt"), "a\nb\n").unwrap();

    stage_hunks(&path, "a.txt", &[]).unwrap();
    let indexed = read_index_blob(&path, "a.txt");
    assert_eq!(indexed, "a\n");
}
