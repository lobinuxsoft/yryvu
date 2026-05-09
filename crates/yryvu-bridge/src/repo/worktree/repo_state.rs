// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::{BackendError, RepoStateInfo};
use crate::repo::common::{git2_err, open_git2};

pub fn abort_merge(repo_path: &Path) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    // Reset hard to HEAD, then clean up MERGE_HEAD / MERGE_MSG.
    let head = repo.head().map_err(git2_err)?;
    let head_commit = head.peel_to_commit().map_err(git2_err)?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.reset(
        head_commit.as_object(),
        git2::ResetType::Hard,
        Some(&mut checkout),
    )
    .map_err(git2_err)?;
    repo.cleanup_state().map_err(git2_err)?;
    Ok(())
}

pub fn repo_state(repo_path: &Path) -> Result<RepoStateInfo, BackendError> {
    let repo = open_git2(repo_path)?;
    let state = repo.state();
    let kind = match state {
        git2::RepositoryState::Clean => "clean",
        git2::RepositoryState::Merge => "merge",
        git2::RepositoryState::Revert | git2::RepositoryState::RevertSequence => "revert",
        git2::RepositoryState::CherryPick | git2::RepositoryState::CherryPickSequence => {
            "cherry-pick"
        }
        git2::RepositoryState::Bisect => "bisect",
        git2::RepositoryState::Rebase
        | git2::RepositoryState::RebaseInteractive
        | git2::RepositoryState::RebaseMerge => "rebase",
        git2::RepositoryState::ApplyMailbox | git2::RepositoryState::ApplyMailboxOrRebase => {
            "apply-mailbox"
        }
    }
    .to_string();

    let conflict_paths = if state == git2::RepositoryState::Clean {
        Vec::new()
    } else {
        let idx = repo.index().map_err(git2_err)?;
        if idx.has_conflicts() {
            let mut paths: Vec<String> = idx
                .conflicts()
                .map_err(git2_err)?
                .filter_map(|c| c.ok())
                .filter_map(|c| c.our.or(c.their).or(c.ancestor))
                .map(|e| String::from_utf8_lossy(&e.path).into_owned())
                .collect();
            paths.sort();
            paths.dedup();
            paths
        } else {
            Vec::new()
        }
    };

    Ok(RepoStateInfo {
        kind,
        conflict_paths,
    })
}
