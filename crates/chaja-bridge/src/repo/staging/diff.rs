// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use crate::backend::{BackendError, FileDiff};

use super::super::common::{diff_to_file_diffs, git2_err, open_git2};

pub fn diff_unstaged(repo_path: &Path, path: &str) -> Result<FileDiff, BackendError> {
    let repo = open_git2(repo_path)?;
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true)
        .context_lines(3)
        .pathspec(path);

    let index = repo.index().map_err(git2_err)?;
    let diff = repo
        .diff_index_to_workdir(Some(&index), Some(&mut diff_opts))
        .map_err(git2_err)?;

    single_file_from_diff(&diff, path)
}

pub fn diff_staged(repo_path: &Path, path: &str) -> Result<FileDiff, BackendError> {
    let repo = open_git2(repo_path)?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.context_lines(3).pathspec(path);

    let diff = repo
        .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut diff_opts))
        .map_err(git2_err)?;

    single_file_from_diff(&diff, path)
}

fn single_file_from_diff(diff: &git2::Diff, path: &str) -> Result<FileDiff, BackendError> {
    let files = diff_to_file_diffs(diff)?;
    files
        .into_iter()
        .find(|f| f.path == path || f.old_path.as_deref() == Some(path))
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("no diff for path '{path}'")))
}
