// SPDX-License-Identifier: AGPL-3.0-or-later

//! Working-tree staging and commit-creation ops.
//!
//! **Backend choice — why git2 dominates this module (as of gix 0.68)**:
//!
//! Chajá's rule is gix-primary, git2 only for ops gix hasn't stabilised
//! yet. For every function here the verification found gix still missing
//! a piece of the pipeline — so they all live on git2 until gix catches
//! up. Each function carries a `BACKEND: git2 — <reason>` marker so a
//! future gix-migration pass can grep and revisit them in one sweep.
//!
//! * Index read/write (add_path, remove_path, write_tree) — gix-index 0.37
//!   exposes reading but no `write_tree`-from-state. Blocks `create_commit`,
//!   `stage_*`, `unstage_*`, and the tree step of amend.
//! * Force-checkout of specific paths — gix-worktree-state 0.15 has
//!   `checkout` but no path-scoped `CheckoutBuilder::path()` equivalent.
//!   Blocks `discard_paths`.
//! * Push with refspecs + credential callbacks — gix has a remote/push
//!   surface but auth + progress are still beta. Blocks
//!   `push_current_branch` / `commit_and_push`.
//!
//! gix's `commit_as()` / `commit()` (write commit object + update HEAD
//! with reflog) are mature, but useless here without a tree id — which
//! is exactly the step gix-index still owes us.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::backend::{BackendError, FileDiff, FileStatus};

use super::common::{diff_to_file_diffs, git2_err, open_git2};

/// Options bundle for `create_commit`. GitKraken's commit saga passes the
/// same knobs: summary + optional description body, amend flag, skip-hooks
/// (bypass pre-commit), and GPG sign.
///
/// Notes on backend capability:
///
/// * `skip_hooks` is effectively always-on: libgit2 (which git2-rs wraps)
///   never runs pre-commit / commit-msg hooks. The field is accepted for
///   API parity with GK but is a no-op — commits always behave as if the
///   flag were set.
/// * `gpg_sign = true` returns `BackendError::NotImplemented` for now:
///   signing requires shelling out to `gpg` or a GPG-agent bridge, which
///   is tracked in a separate preferences-gated issue.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOptions {
    /// Subject line. Trimmed; empty is rejected.
    pub summary: String,
    /// Optional body. When non-empty, joined to the summary with a blank
    /// line separator (Conventional-Commit shape).
    #[serde(default)]
    pub description: String,
    /// Rewrite HEAD instead of creating a new commit (`git commit --amend`).
    /// Errors when HEAD is unborn.
    #[serde(default)]
    pub amend: bool,
    /// Bypass pre-commit / commit-msg hooks. No-op on git2 — hooks are
    /// never invoked.
    #[serde(default)]
    pub skip_hooks: bool,
    /// GPG-sign the commit. Currently unimplemented; passing `true`
    /// returns `BackendError::NotImplemented`.
    #[serde(default)]
    pub gpg_sign: bool,
}

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

/// Compose the final commit message from `summary` + optional `description`
/// with a blank-line separator. Strips trailing whitespace off each side;
/// returns `None` if the summary is empty after trimming.
fn compose_message(summary: &str, description: &str) -> Option<String> {
    let summary = summary.trim();
    if summary.is_empty() {
        return None;
    }
    let description = description.trim();
    if description.is_empty() {
        Some(summary.to_string())
    } else {
        Some(format!("{summary}\n\n{description}"))
    }
}

/// Write a new commit (or amend HEAD) with the bundled options. Replaces
/// the pair `commit_staged` / `amend_commit` — both kept as thin wrappers
/// below for call sites that don't care about description / flags.
///
/// BACKEND: git2 — needs `index.write_tree()` to materialise the staged
/// tree before the commit object. gix 0.68 / gix-index 0.37 read the
/// index but don't expose a state→tree writer yet. Migrate to
/// `gix::Repository::commit_as()` once gix-index gains a `write_tree`
/// equivalent.
pub fn create_commit(repo_path: &Path, opts: &CommitOptions) -> Result<String, BackendError> {
    let message = compose_message(&opts.summary, &opts.description)
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("commit message cannot be empty")))?;

    if opts.gpg_sign {
        return Err(BackendError::NotImplemented("gpg commit signing"));
    }

    let repo = open_git2(repo_path)?;
    let signature = repo.signature().map_err(git2_err)?;

    let mut index = repo.index().map_err(git2_err)?;
    let tree_oid = index.write_tree().map_err(git2_err)?;
    let tree = repo.find_tree(tree_oid).map_err(git2_err)?;

    if opts.amend {
        let head = repo
            .head()
            .map_err(|_| BackendError::Git(anyhow::anyhow!("cannot amend: no HEAD commit")))?;
        let head_commit = head.peel_to_commit().map_err(git2_err)?;

        let new_oid = head_commit
            .amend(
                Some("HEAD"),
                None,
                Some(&signature),
                None,
                Some(&message),
                Some(&tree),
            )
            .map_err(git2_err)?;
        return Ok(new_oid.to_string());
    }

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
            &message,
            &tree,
            &parent_refs,
        )
        .map_err(git2_err)?;

    Ok(new_oid.to_string())
}

pub fn commit_staged(repo_path: &Path, message: &str) -> Result<String, BackendError> {
    create_commit(
        repo_path,
        &CommitOptions {
            summary: message.to_string(),
            ..CommitOptions::default()
        },
    )
}

pub fn amend_commit(repo_path: &Path, message: &str) -> Result<String, BackendError> {
    create_commit(
        repo_path,
        &CommitOptions {
            summary: message.to_string(),
            amend: true,
            ..CommitOptions::default()
        },
    )
}

/// Stage every unstaged change in the working tree (equivalent to
/// `git add -A`): modifications, deletions, and untracked files — all go
/// into the index in one shot. Returns the list of paths staged so the
/// frontend can update local state without re-reading `working_tree_status`.
///
/// BACKEND: git2 (transitively via `stage_files`) — same blocker as
/// `create_commit`: gix-index has no index-write helpers at 0.37.
pub fn stage_all(repo_path: &Path) -> Result<Vec<String>, BackendError> {
    let status = working_tree_status(repo_path)?;
    let paths: Vec<String> = status.unstaged.into_iter().map(|c| c.path).collect();
    if paths.is_empty() {
        return Ok(paths);
    }
    stage_files(repo_path, &paths)?;
    Ok(paths)
}

/// Reset every staged entry back to HEAD (`git reset HEAD`). On an unborn
/// branch this clears the index entirely. Returns the list of paths that
/// were unstaged.
///
/// BACKEND: git2 (transitively via `unstage_files`) — `reset_default` has
/// no gix equivalent yet (reset operations against the index are still
/// incubating).
pub fn unstage_all(repo_path: &Path) -> Result<Vec<String>, BackendError> {
    let status = working_tree_status(repo_path)?;
    let paths: Vec<String> = status.staged.into_iter().map(|c| c.path).collect();
    if paths.is_empty() {
        return Ok(paths);
    }
    unstage_files(repo_path, &paths)?;
    Ok(paths)
}

/// Destructively discard unstaged changes for the given paths
/// (`git checkout -- <paths>` + `rm` on untracked). Never touches the
/// index — a partially-staged file keeps its staged hunks, only the
/// workdir is reverted to match.
///
/// BACKEND: git2 — needs path-scoped force-checkout from HEAD tree.
/// gix-worktree-state 0.15 has whole-tree checkout but no
/// `CheckoutBuilder::path()` equivalent. Migrate once gix exposes
/// per-path checkout.
///
/// Split per-path by status:
///
/// * tracked + modified/deleted → force-checkout from HEAD tree (workdir
///   snaps back to the committed version).
/// * untracked (WT_NEW) → physically remove from disk.
///
/// Caller MUST confirm destructive intent beforehand; once this returns,
/// uncommitted changes to those paths are gone.
pub fn discard_paths(repo_path: &Path, paths: &[String]) -> Result<(), BackendError> {
    if paths.is_empty() {
        return Ok(());
    }

    let repo = open_git2(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("bare repo: no working tree")))?
        .to_path_buf();

    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(git2_err)?;

    let mut tracked_to_checkout: Vec<String> = Vec::new();
    let mut untracked_to_remove: Vec<String> = Vec::new();

    let requested: std::collections::HashSet<&str> = paths.iter().map(String::as_str).collect();

    for entry in statuses.iter() {
        let path = match entry.path() {
            Some(p) => p.to_string(),
            None => continue,
        };
        if !requested.contains(path.as_str()) {
            continue;
        }
        let st = entry.status();
        if st.contains(git2::Status::WT_NEW) {
            untracked_to_remove.push(path);
        } else if st.intersects(
            git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_RENAMED
                | git2::Status::WT_TYPECHANGE,
        ) {
            tracked_to_checkout.push(path);
        }
    }

    if !tracked_to_checkout.is_empty() {
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout.force().remove_untracked(false);
        for p in &tracked_to_checkout {
            checkout.path(p);
        }
        repo.checkout_head(Some(&mut checkout)).map_err(git2_err)?;
    }

    for rel in untracked_to_remove {
        let absolute = workdir.join(&rel);
        // `rel` came from git status so it refers to a file (or an
        // untracked symlink); `remove_file` handles both. Swallow NotFound
        // defensively — concurrent fs edits shouldn't fail the whole op.
        match std::fs::remove_file(&absolute) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(BackendError::Git(anyhow::anyhow!(
                    "remove untracked '{rel}': {e}"
                )));
            }
        }
    }

    Ok(())
}

/// GitKraken's one-shot `Commit and Push`: write the commit, then push
/// HEAD's branch to its upstream. The commit is already durable if the
/// push fails, so the caller can retry the push alone.
///
/// BACKEND: git2 (transitively) — see `create_commit` and
/// `push_current_branch` for individual migration blockers.
pub fn commit_and_push(repo_path: &Path, opts: &CommitOptions) -> Result<String, BackendError> {
    let new_sha = create_commit(repo_path, opts)?;
    super::remote::push_current_branch(repo_path, crate::backend::PushOptions::default())?;
    Ok(new_sha)
}

pub fn head_commit_message(repo_path: &Path) -> Result<String, BackendError> {
    let repo = open_git2(repo_path)?;
    let head = repo
        .head()
        .map_err(|_| BackendError::Git(anyhow::anyhow!("no HEAD commit")))?;
    let head_commit = head.peel_to_commit().map_err(git2_err)?;
    Ok(head_commit.message().unwrap_or_default().to_string())
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
