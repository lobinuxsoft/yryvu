// SPDX-License-Identifier: AGPL-3.0-or-later

//! Conflict resolution surface (issue #10). Builds on `repo.state()`
//! to detect the source of the conflicted index, reads the three
//! merge stages (1 = ancestor, 2 = ours, 3 = theirs) for the diff3
//! view, and applies the user's choice back to stage 0.
//!
//! Companion of `repo::rebase::interactive` (#11): when the yryvu
//! orchestrator pauses on a conflict, the index already holds the
//! stages this module reads.

mod resolve;

#[cfg(test)]
mod tests;

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::common::{git2_err, open_git2};

#[allow(unused_imports)]
pub use resolve::{
    accept_side, detect_conflict_markers, finish_in_progress, mark_resolved, read_diff3,
    resolve_with_content,
};

/// What native git operation produced the conflicted index. Mirrors
/// `git2::RepositoryState` plus an `InteractiveRebase` arm for the
/// yryvu custom orchestrator (#11), which uses its own state file
/// instead of `.git/rebase-merge/`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConflictSource {
    Merge,
    Rebase,
    InteractiveRebase,
    CherryPick,
    Revert,
    Bisect,
    /// Index has conflicts but no in-progress op is recorded (e.g.
    /// the user ran `git checkout -m` or aborted halfway).
    Standalone,
}

/// Which of the three merge sides to accept verbatim.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConflictSide {
    Ours,
    Theirs,
    Base,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConflictedFile {
    pub path: String,
    pub has_ancestor: bool,
    pub has_ours: bool,
    pub has_theirs: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConflictListing {
    pub source: ConflictSource,
    pub files: Vec<ConflictedFile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConflictDiff3 {
    /// Common ancestor blob — `None` for an add/add conflict (no base).
    pub base: Option<String>,
    /// "Ours" side blob — `None` for a delete/modify conflict from our side.
    pub ours: Option<String>,
    /// "Theirs" side blob — `None` for a modify/delete from their side.
    pub theirs: Option<String>,
    /// Current worktree content (includes conflict markers when libgit2
    /// has written them) — what the user edits.
    pub working: String,
}

/// Enumerate every conflicted path in the index. Returns the empty
/// listing (with `source = Standalone`) when the working tree is clean.
pub fn list_conflicts(repo_path: &Path) -> Result<ConflictListing, BackendError> {
    let repo = open_git2(repo_path)?;
    let source = detect_source(&repo, repo_path);
    let idx = repo.index().map_err(git2_err)?;
    if !idx.has_conflicts() {
        return Ok(ConflictListing {
            source,
            files: Vec::new(),
        });
    }
    let mut seen = std::collections::BTreeMap::<String, ConflictedFile>::new();
    for c in idx.conflicts().map_err(git2_err)?.filter_map(|c| c.ok()) {
        let any = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref());
        let Some(entry) = any else { continue };
        let path = String::from_utf8_lossy(&entry.path).into_owned();
        let file = seen.entry(path.clone()).or_insert(ConflictedFile {
            path,
            has_ancestor: false,
            has_ours: false,
            has_theirs: false,
        });
        file.has_ancestor = file.has_ancestor || c.ancestor.is_some();
        file.has_ours = file.has_ours || c.our.is_some();
        file.has_theirs = file.has_theirs || c.their.is_some();
    }
    Ok(ConflictListing {
        source,
        files: seen.into_values().collect(),
    })
}

fn detect_source(repo: &git2::Repository, repo_path: &Path) -> ConflictSource {
    if repo_path
        .join(".git")
        .join("yryvu-rebase-state.json")
        .exists()
    {
        return ConflictSource::InteractiveRebase;
    }
    match repo.state() {
        git2::RepositoryState::Merge => ConflictSource::Merge,
        git2::RepositoryState::CherryPick | git2::RepositoryState::CherryPickSequence => {
            ConflictSource::CherryPick
        }
        git2::RepositoryState::Revert | git2::RepositoryState::RevertSequence => {
            ConflictSource::Revert
        }
        git2::RepositoryState::Bisect => ConflictSource::Bisect,
        git2::RepositoryState::Rebase
        | git2::RepositoryState::RebaseInteractive
        | git2::RepositoryState::RebaseMerge
        | git2::RepositoryState::ApplyMailbox
        | git2::RepositoryState::ApplyMailboxOrRebase => ConflictSource::Rebase,
        git2::RepositoryState::Clean => ConflictSource::Standalone,
    }
}
