// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use serde::Serialize;

use crate::backend::{BackendError, FileDiff, FileStatus};

use super::common::{diff_to_file_diffs, git2_err, open_git2};

/// A single file entry in the working-tree status view.
#[derive(Debug, Clone, Serialize)]
pub struct WorkingTreeChange {
    pub path: String,
    /// Previous path for renames/copies (staged side only).
    pub old_path: Option<String>,
    pub status: FileStatus,
}

/// Result of a working-tree scan: files split into unstaged (workdir vs index)
/// and staged (index vs HEAD) sides. The same path can appear in both when a
/// file has been partially staged.
#[derive(Debug, Clone, Serialize)]
pub struct WorkingTreeStatus {
    pub unstaged: Vec<WorkingTreeChange>,
    pub staged: Vec<WorkingTreeChange>,
}

pub fn working_tree_status(repo_path: &Path) -> Result<WorkingTreeStatus, BackendError> {
    let repo = open_git2(repo_path)?;
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo.statuses(Some(&mut opts)).map_err(git2_err)?;

    let mut unstaged = Vec::new();
    let mut staged = Vec::new();

    for entry in statuses.iter() {
        let st = entry.status();
        let path = match entry.path() {
            Some(p) => p.to_string(),
            None => continue,
        };

        // Staged side: index vs HEAD
        let staged_status = if st.contains(git2::Status::INDEX_NEW) {
            Some(FileStatus::Added)
        } else if st.contains(git2::Status::INDEX_MODIFIED) {
            Some(FileStatus::Modified)
        } else if st.contains(git2::Status::INDEX_DELETED) {
            Some(FileStatus::Deleted)
        } else if st.contains(git2::Status::INDEX_RENAMED) {
            Some(FileStatus::Renamed)
        } else if st.contains(git2::Status::INDEX_TYPECHANGE) {
            Some(FileStatus::TypeChange)
        } else {
            None
        };

        // Unstaged side: workdir vs index. Untracked files show up as WT_NEW.
        let unstaged_status = if st.contains(git2::Status::WT_NEW) {
            Some(FileStatus::Added)
        } else if st.contains(git2::Status::WT_MODIFIED) {
            Some(FileStatus::Modified)
        } else if st.contains(git2::Status::WT_DELETED) {
            Some(FileStatus::Deleted)
        } else if st.contains(git2::Status::WT_RENAMED) {
            Some(FileStatus::Renamed)
        } else if st.contains(git2::Status::WT_TYPECHANGE) {
            Some(FileStatus::TypeChange)
        } else {
            None
        };

        if let Some(status) = staged_status {
            let old_path = entry.head_to_index().and_then(|d| {
                d.old_file()
                    .path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .filter(|old| old != &path)
            });
            staged.push(WorkingTreeChange {
                path: path.clone(),
                old_path,
                status,
            });
        }
        if let Some(status) = unstaged_status {
            unstaged.push(WorkingTreeChange {
                path,
                old_path: None,
                status,
            });
        }
    }

    unstaged.sort_by(|a, b| a.path.cmp(&b.path));
    staged.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(WorkingTreeStatus { unstaged, staged })
}

pub fn stage_files(repo_path: &Path, paths: &[String]) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;
    let workdir = repo.workdir().map(|p| p.to_path_buf());
    let mut index = repo.index().map_err(git2_err)?;

    for path in paths {
        let rel = Path::new(path);
        let exists_in_workdir = workdir
            .as_ref()
            .map(|w| w.join(rel).exists())
            .unwrap_or(false);

        if exists_in_workdir {
            index.add_path(rel).map_err(git2_err)?;
        } else {
            // File deleted in workdir — stage the deletion.
            index.remove_path(rel).map_err(git2_err)?;
        }
    }

    index.write().map_err(git2_err)?;
    Ok(())
}

pub fn unstage_files(repo_path: &Path, paths: &[String]) -> Result<(), BackendError> {
    let repo = open_git2(repo_path)?;

    let head_obj = repo
        .head()
        .ok()
        .and_then(|h| h.peel(git2::ObjectType::Any).ok());

    if let Some(head_obj) = head_obj {
        let specs: Vec<&str> = paths.iter().map(String::as_str).collect();
        repo.reset_default(Some(&head_obj), specs.iter())
            .map_err(git2_err)?;
    } else {
        // Unborn branch (no HEAD commit yet) — clear the matching index entries.
        let mut index = repo.index().map_err(git2_err)?;
        for path in paths {
            let _ = index.remove_path(Path::new(path));
        }
        index.write().map_err(git2_err)?;
    }
    Ok(())
}

pub fn commit_staged(repo_path: &Path, message: &str) -> Result<String, BackendError> {
    if message.trim().is_empty() {
        return Err(BackendError::Git(anyhow::anyhow!(
            "commit message cannot be empty"
        )));
    }

    let repo = open_git2(repo_path)?;
    let signature = repo.signature().map_err(git2_err)?;

    let mut index = repo.index().map_err(git2_err)?;
    let tree_oid = index.write_tree().map_err(git2_err)?;
    let tree = repo.find_tree(tree_oid).map_err(git2_err)?;

    let parents: Vec<git2::Commit> = match repo.head().ok() {
        Some(head) => {
            let commit = head.peel_to_commit().map_err(git2_err)?;
            vec![commit]
        }
        None => Vec::new(),
    };

    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

    let new_oid = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parent_refs,
        )
        .map_err(git2_err)?;

    Ok(new_oid.to_string())
}

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
