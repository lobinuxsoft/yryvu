// SPDX-License-Identifier: AGPL-3.0-or-later

//! Hunk- and line-level partial staging operations.
//!
//! Mirrors GitKraken's `updateEntryInIndex(entry, range, stage, revert)`
//! saga (research doc `gitkraken-diff/03-hunk-navigation.md`). The flow:
//!
//! 1. Re-generate the relevant diff for the file (workdir-vs-index for
//!    stage/discard, index-vs-HEAD for unstage). Fresh on every call so
//!    stale hunk indices from a long-lived frontend cache can't corrupt
//!    the index.
//! 2. Render a synthetic unidiff buffer that contains only the selected
//!    hunks (or selected lines within a hunk) — see [`unidiff`].
//! 3. Hand the buffer to `git2::Diff::from_buffer` + `repo.apply()`.
//!
//! libgit2 has no `reverse` flag on `git_apply`, so unstage and discard
//! pre-swap the patch sides (`---` ↔ `+++`, `-` ↔ `+`, hunk header
//! ranges swapped). Forward-applying a side-swapped patch achieves the
//! same end state as reverse-applying the original.
//!
//! BACKEND: git2 — see [`super::mod`] header for the gix-blocker list.
//! `Diff::from_buffer` + `Repository::apply` have no gix equivalent at
//! 0.68 (gix-diff parses but the apply surface is incubating).
//!
//! Edge cases:
//! - "No newline at end of file" marker is not emitted — assumes content
//!   lines end with `\n`. Real-world repos overwhelmingly do.
//! - Binary diffs are guarded out upstream (`FileDiff.is_binary == true`
//!   yields empty `hunks`; the early-return path handles it).

use std::path::Path;

use git2::{ApplyLocation, Diff};
use serde::Deserialize;

use crate::backend::{BackendError, FileDiff};

use super::super::common::{diff_to_file_diffs, git2_err, open_git2};

#[cfg(test)]
mod tests;
mod unidiff;

/// One slice of changed lines within a single hunk that the caller wants
/// to apply. Line indices reference [`crate::backend::DiffHunk::lines`]
/// positions (0-based) — only `Added` / `Removed` entries are honored;
/// `Context` indices are silently ignored. Deserialized from the Tauri
/// command layer, hence the camelCase wire shape.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRange {
    pub hunk_index: usize,
    pub line_indices: Vec<u32>,
}

#[derive(Debug, Clone, Copy)]
enum Target {
    /// Forward apply to index: stage workdir → index.
    StageIndex,
    /// Reverse apply to index (sides swapped): unstage index → HEAD.
    UnstageIndex,
    /// Reverse apply to workdir (sides swapped): revert workdir → index.
    DiscardWorkdir,
}

impl Target {
    fn diff_against(self) -> DiffSource {
        match self {
            Target::StageIndex | Target::DiscardWorkdir => DiffSource::WorkdirVsIndex,
            Target::UnstageIndex => DiffSource::IndexVsHead,
        }
    }

    fn swap_sides(self) -> bool {
        matches!(self, Target::UnstageIndex | Target::DiscardWorkdir)
    }

    fn apply_location(self) -> ApplyLocation {
        match self {
            Target::StageIndex | Target::UnstageIndex => ApplyLocation::Index,
            Target::DiscardWorkdir => ApplyLocation::WorkDir,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum DiffSource {
    WorkdirVsIndex,
    IndexVsHead,
}

pub(super) enum Selection<'a> {
    Hunks(&'a [usize]),
    Lines(&'a [LineRange]),
}

// ───────────────────────────────────────────── public ops ──────

pub fn stage_hunks(
    repo_path: &Path,
    path: &str,
    hunk_indices: &[usize],
) -> Result<(), BackendError> {
    apply_partial(
        repo_path,
        path,
        Target::StageIndex,
        Selection::Hunks(hunk_indices),
    )
}

pub fn unstage_hunks(
    repo_path: &Path,
    path: &str,
    hunk_indices: &[usize],
) -> Result<(), BackendError> {
    apply_partial(
        repo_path,
        path,
        Target::UnstageIndex,
        Selection::Hunks(hunk_indices),
    )
}

pub fn discard_hunks(
    repo_path: &Path,
    path: &str,
    hunk_indices: &[usize],
) -> Result<(), BackendError> {
    apply_partial(
        repo_path,
        path,
        Target::DiscardWorkdir,
        Selection::Hunks(hunk_indices),
    )
}

pub fn stage_lines(repo_path: &Path, path: &str, ranges: &[LineRange]) -> Result<(), BackendError> {
    apply_partial(
        repo_path,
        path,
        Target::StageIndex,
        Selection::Lines(ranges),
    )
}

pub fn unstage_lines(
    repo_path: &Path,
    path: &str,
    ranges: &[LineRange],
) -> Result<(), BackendError> {
    apply_partial(
        repo_path,
        path,
        Target::UnstageIndex,
        Selection::Lines(ranges),
    )
}

pub fn discard_lines(
    repo_path: &Path,
    path: &str,
    ranges: &[LineRange],
) -> Result<(), BackendError> {
    apply_partial(
        repo_path,
        path,
        Target::DiscardWorkdir,
        Selection::Lines(ranges),
    )
}

// ───────────────────────────────────────────── orchestrator ────

fn apply_partial(
    repo_path: &Path,
    path: &str,
    target: Target,
    selection: Selection<'_>,
) -> Result<(), BackendError> {
    if selection_is_empty(&selection) {
        return Ok(());
    }
    let file = current_file_diff(repo_path, path, target.diff_against())?;
    if file.hunks.is_empty() {
        return Ok(());
    }

    let (patch, any_hunk) = unidiff::build_unidiff(&file, &selection, target.swap_sides())?;
    if !any_hunk {
        return Ok(());
    }

    let repo = open_git2(repo_path)?;
    let diff = Diff::from_buffer(patch.as_bytes()).map_err(git2_err)?;
    repo.apply(&diff, target.apply_location(), None)
        .map_err(git2_err)?;
    Ok(())
}

fn selection_is_empty(selection: &Selection<'_>) -> bool {
    match selection {
        Selection::Hunks(idx) => idx.is_empty(),
        Selection::Lines(ranges) => ranges.iter().all(|r| r.line_indices.is_empty()),
    }
}

fn current_file_diff(
    repo_path: &Path,
    path: &str,
    source: DiffSource,
) -> Result<FileDiff, BackendError> {
    let repo = open_git2(repo_path)?;
    let mut opts = git2::DiffOptions::new();
    opts.context_lines(3).pathspec(path);

    let diff = match source {
        DiffSource::WorkdirVsIndex => {
            opts.include_untracked(true)
                .recurse_untracked_dirs(true)
                .show_untracked_content(true);
            let index = repo.index().map_err(git2_err)?;
            repo.diff_index_to_workdir(Some(&index), Some(&mut opts))
                .map_err(git2_err)?
        }
        DiffSource::IndexVsHead => {
            let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
            repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
                .map_err(git2_err)?
        }
    };

    diff_to_file_diffs(&diff)?
        .into_iter()
        .find(|f| f.path == path || f.old_path.as_deref() == Some(path))
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("no diff for path '{path}'")))
}
