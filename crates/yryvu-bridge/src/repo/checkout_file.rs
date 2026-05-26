// SPDX-License-Identifier: AGPL-3.0-or-later

//! Single-file checkout (issue #7 — "Checkout file at specific commit").
//!
//! Writes the blob at `sha:path` over the working-tree copy + updates
//! the index entry. Other paths are untouched. Caller (UI) must
//! confirm with the user — operation overwrites uncommitted changes
//! to the target path.

use std::path::Path;

use crate::backend::BackendError;

use super::common::{git2_err, open_git2};

pub fn checkout_file_at(repo_path: &Path, path: &str, sha: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let oid = git2::Oid::from_str(sha)
        .map_err(|e| BackendError::Git(anyhow::anyhow!("invalid sha '{sha}': {e}")))?;
    let commit = repo.find_commit(oid).map_err(git2_err)?;
    let tree = commit.tree().map_err(git2_err)?;

    let mut opts = git2::build::CheckoutBuilder::new();
    opts.force().update_index(true).path(path);

    repo.checkout_tree(tree.as_object(), Some(&mut opts))
        .map_err(git2_err)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(repo)
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }

    #[test]
    fn rolls_one_file_back_without_touching_others() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        std::fs::write(p.join("a.txt"), "v1\n").unwrap();
        std::fs::write(p.join("b.txt"), "x\n").unwrap();
        git(p, &["add", "a.txt", "b.txt"]);
        git(p, &["commit", "-q", "-m", "initial"]);
        let initial = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(p)
            .output()
            .unwrap();
        let initial_sha = String::from_utf8(initial.stdout)
            .unwrap()
            .trim()
            .to_string();

        std::fs::write(p.join("a.txt"), "v2\n").unwrap();
        std::fs::write(p.join("b.txt"), "y\n").unwrap();
        git(p, &["commit", "-aq", "-m", "v2"]);

        checkout_file_at(p, "a.txt", &initial_sha).unwrap();
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "v1\n");
        // b.txt stays at HEAD.
        assert_eq!(std::fs::read_to_string(p.join("b.txt")).unwrap(), "y\n");
    }
}
