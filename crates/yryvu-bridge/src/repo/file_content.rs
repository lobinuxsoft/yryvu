// SPDX-License-Identifier: AGPL-3.0-or-later

//! Raw file content readers for the INLINE / CONTENT diff view modes
//! (issue #59). Three sources mirror what GitKraken's Monaco editor wires
//! up: working tree (`fs::read`), index blob (`git2 index entry → blob`),
//! and commit tree blob (`git2 commit tree → entry → blob`).
//!
//! Diff modes can build all their views from a `FileDiff` *plus* one or
//! two `FileContent` reads — no need to teach the diff pipeline about
//! "render full file" cases.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::backend::{BackendError, DIFF_MAX_FILE_BYTES};

use super::common::{git2_err, open_git2};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "kind")]
pub enum FileContentSource {
    WorkingTree,
    Index,
    Head,
    Commit {
        sha: String,
    },
    /// First parent of `sha`. Resolves the "before" side of a commit diff
    /// without the frontend having to carry the parent OID — used by the
    /// image viewer to fetch the old image (#60). A root commit (no
    /// parent) resolves to missing, so an added file shows no old side.
    CommitParent {
        sha: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    /// UTF-8 text content. Empty when `is_binary || missing || truncated`.
    pub content: String,
    pub is_binary: bool,
    /// Source size in bytes (workdir file size, or blob size). `0` when missing.
    pub size: u64,
    /// `true` when the source has no entry for `path` (e.g. CONTENT mode
    /// while staring at an added-but-not-staged file with `Index` source).
    pub missing: bool,
    /// `true` when `size > DIFF_MAX_FILE_BYTES`; `content` stays empty.
    pub truncated: bool,
}

/// Detect binary content using git's heuristic — null byte in the first
/// 8 KiB. Cheap, matches what `git diff` does internally.
fn looks_binary(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(8192)];
    head.contains(&0)
}

fn from_bytes(bytes: Vec<u8>) -> FileContent {
    let size = bytes.len() as u64;
    if size > DIFF_MAX_FILE_BYTES {
        return FileContent {
            content: String::new(),
            is_binary: false,
            size,
            missing: false,
            truncated: true,
        };
    }
    if looks_binary(&bytes) {
        return FileContent {
            content: String::new(),
            is_binary: true,
            size,
            missing: false,
            truncated: false,
        };
    }
    let content = String::from_utf8_lossy(&bytes).into_owned();
    FileContent {
        content,
        is_binary: false,
        size,
        missing: false,
        truncated: false,
    }
}

fn missing() -> FileContent {
    FileContent {
        content: String::new(),
        is_binary: false,
        size: 0,
        missing: true,
        truncated: false,
    }
}

fn workdir_bytes(repo_path: &Path, path: &str) -> Result<Option<Vec<u8>>, BackendError> {
    let abs = repo_path.join(path);
    match std::fs::read(&abs) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(BackendError::Git(anyhow::anyhow!(
            "read {} failed: {e}",
            abs.display()
        ))),
    }
}

fn index_bytes(repo: &git2::Repository, path: &str) -> Result<Option<Vec<u8>>, BackendError> {
    let index = repo.index().map_err(git2_err)?;
    let Some(entry) = index.get_path(Path::new(path), 0) else {
        return Ok(None);
    };
    let blob = repo.find_blob(entry.id).map_err(git2_err)?;
    Ok(Some(blob.content().to_vec()))
}

fn tree_blob_bytes(
    repo: &git2::Repository,
    tree: &git2::Tree<'_>,
    path: &str,
) -> Result<Option<Vec<u8>>, BackendError> {
    match tree.get_path(Path::new(path)) {
        Ok(entry) => {
            let object = entry.to_object(repo).map_err(git2_err)?;
            Ok(object.as_blob().map(|b| b.content().to_vec()))
        }
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(git2_err(e)),
    }
}

fn parse_oid(sha: &str) -> Result<git2::Oid, BackendError> {
    git2::Oid::from_str(sha)
        .map_err(|e| BackendError::Git(anyhow::anyhow!("invalid sha '{sha}': {e}")))
}

fn commit_bytes(
    repo: &git2::Repository,
    sha: &str,
    path: &str,
) -> Result<Option<Vec<u8>>, BackendError> {
    let commit = repo.find_commit(parse_oid(sha)?).map_err(git2_err)?;
    let tree = commit.tree().map_err(git2_err)?;
    tree_blob_bytes(repo, &tree, path)
}

fn parent_bytes(
    repo: &git2::Repository,
    sha: &str,
    path: &str,
) -> Result<Option<Vec<u8>>, BackendError> {
    let commit = repo.find_commit(parse_oid(sha)?).map_err(git2_err)?;
    // A root commit has no parent — the file has no "before" side.
    let Ok(parent) = commit.parent(0) else {
        return Ok(None);
    };
    let tree = parent.tree().map_err(git2_err)?;
    tree_blob_bytes(repo, &tree, path)
}

/// Resolve a `(path, source)` pair to its raw bytes, or `None` when the
/// source has no entry for that path. Shared by the text reader
/// (`read_file_content`) and the image-bytes reader (`read_file_bytes`).
pub(super) fn source_bytes(
    repo_path: &Path,
    path: &str,
    source: &FileContentSource,
) -> Result<Option<Vec<u8>>, BackendError> {
    match source {
        FileContentSource::WorkingTree => workdir_bytes(repo_path, path),
        FileContentSource::Index => {
            let repo = open_git2(repo_path)?;
            index_bytes(&repo, path)
        }
        FileContentSource::Head => {
            let repo = open_git2(repo_path)?;
            let head = repo.head().map_err(git2_err)?;
            let commit = head.peel_to_commit().map_err(git2_err)?;
            commit_bytes(&repo, &commit.id().to_string(), path)
        }
        FileContentSource::Commit { sha } => {
            let repo = open_git2(repo_path)?;
            commit_bytes(&repo, sha, path)
        }
        FileContentSource::CommitParent { sha } => {
            let repo = open_git2(repo_path)?;
            parent_bytes(&repo, sha, path)
        }
    }
}

pub fn read_file_content(
    repo_path: &Path,
    path: &str,
    source: &FileContentSource,
) -> Result<FileContent, BackendError> {
    match source_bytes(repo_path, path, source)? {
        Some(bytes) => Ok(from_bytes(bytes)),
        None => Ok(missing()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(repo)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        git(dir.path(), &["init", "-q", "-b", "main"]);
        std::fs::write(dir.path().join("a.txt"), "hello\nworld\n").unwrap();
        git(dir.path(), &["add", "a.txt"]);
        git(dir.path(), &["commit", "-q", "-m", "initial"]);
        dir
    }

    #[test]
    fn reads_workdir() {
        let dir = init_repo();
        std::fs::write(dir.path().join("a.txt"), "changed\n").unwrap();
        let c = read_file_content(dir.path(), "a.txt", &FileContentSource::WorkingTree).unwrap();
        assert_eq!(c.content, "changed\n");
        assert!(!c.is_binary && !c.missing && !c.truncated);
    }

    #[test]
    fn reads_index_and_head() {
        let dir = init_repo();
        std::fs::write(dir.path().join("a.txt"), "v2\n").unwrap();
        let staged = read_file_content(dir.path(), "a.txt", &FileContentSource::Index).unwrap();
        assert_eq!(staged.content, "hello\nworld\n");

        let head = read_file_content(dir.path(), "a.txt", &FileContentSource::Head).unwrap();
        assert_eq!(head.content, "hello\nworld\n");
    }

    #[test]
    fn reports_missing_for_unknown_path() {
        let dir = init_repo();
        let c =
            read_file_content(dir.path(), "ghost.txt", &FileContentSource::WorkingTree).unwrap();
        assert!(c.missing);
        let c = read_file_content(dir.path(), "ghost.txt", &FileContentSource::Index).unwrap();
        assert!(c.missing);
        let c = read_file_content(dir.path(), "ghost.txt", &FileContentSource::Head).unwrap();
        assert!(c.missing);
    }

    #[test]
    fn detects_binary_workdir() {
        let dir = init_repo();
        std::fs::write(dir.path().join("b.bin"), [0u8, 1, 2, 3, 0, 0, 4]).unwrap();
        let c = read_file_content(dir.path(), "b.bin", &FileContentSource::WorkingTree).unwrap();
        assert!(c.is_binary);
        assert!(c.content.is_empty());
    }

    fn head_sha(dir: &Path) -> String {
        let repo = git2::Repository::open(dir).unwrap();
        let commit = repo.head().unwrap().peel_to_commit().unwrap();
        commit.id().to_string()
    }

    #[test]
    fn commit_parent_resolves_old_side() {
        let dir = init_repo();
        std::fs::write(dir.path().join("a.txt"), "v2\n").unwrap();
        git(dir.path(), &["commit", "-aqm", "second"]);
        let head = head_sha(dir.path());

        // The commit itself carries the new content; its parent the old.
        let new = read_file_content(
            dir.path(),
            "a.txt",
            &FileContentSource::Commit { sha: head.clone() },
        )
        .unwrap();
        assert_eq!(new.content, "v2\n");
        let old = read_file_content(
            dir.path(),
            "a.txt",
            &FileContentSource::CommitParent { sha: head },
        )
        .unwrap();
        assert_eq!(old.content, "hello\nworld\n");
    }

    #[test]
    fn commit_parent_of_root_is_missing() {
        let dir = init_repo();
        let root = head_sha(dir.path());
        let old = read_file_content(
            dir.path(),
            "a.txt",
            &FileContentSource::CommitParent { sha: root },
        )
        .unwrap();
        assert!(old.missing);
    }
}
