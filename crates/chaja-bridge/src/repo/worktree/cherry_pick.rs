// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::BackendError;
use crate::repo::common::{git2_err, open_git2};
use crate::undo_log::{record_op_best_effort, OpKind};

pub fn cherry_pick_commit(repo_path: &Path, sha: &str) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let oid = git2::Oid::from_str(sha).map_err(|_| BackendError::CommitNotFound {
        sha: sha.to_string(),
    })?;
    let commit = repo
        .find_commit(oid)
        .map_err(|_| BackendError::CommitNotFound {
            sha: sha.to_string(),
        })?;

    repo.cherrypick(&commit, None).map_err(git2_err)?;

    // If the cherry-pick produced conflicts, git2 writes them to the index and
    // leaves CHERRY_PICK_HEAD in place. Surface MergeConflict so the UI's
    // StateBanner can pick it up and offer an abort.
    let index = repo.index().map_err(git2_err)?;
    if index.has_conflicts() {
        let paths: Vec<String> = index
            .conflicts()
            .map_err(git2_err)?
            .filter_map(|c| c.ok())
            .filter_map(|c| c.our.or(c.their).or(c.ancestor))
            .map(|e| String::from_utf8_lossy(&e.path).into_owned())
            .collect();
        return Err(BackendError::MergeConflict { paths });
    }

    // Clean apply — write the cherry-pick as a new commit on HEAD.
    let tree_oid = repo
        .index()
        .map_err(git2_err)?
        .write_tree()
        .map_err(git2_err)?;
    let tree = repo.find_tree(tree_oid).map_err(git2_err)?;
    let head = repo.head().map_err(git2_err)?;
    let parent_commit = head.peel_to_commit().map_err(git2_err)?;
    let sig = repo.signature().map_err(git2_err)?;
    let new_oid = repo
        .commit(
            Some("HEAD"),
            &commit.author(),
            &sig,
            commit.message().unwrap_or(""),
            &tree,
            &[&parent_commit],
        )
        .map_err(git2_err)?;
    repo.cleanup_state().map_err(git2_err)?;
    record_op_best_effort(
        repo_path,
        OpKind::CherryPick {
            applied_sha: sha.to_string(),
            new_sha: new_oid.to_string(),
        },
    );
    Ok(())
}
