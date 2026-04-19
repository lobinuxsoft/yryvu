// SPDX-License-Identifier: AGPL-3.0-or-later

//! gix + git2 hybrid Git backend. The individual submodules hold the actual
//! logic, grouped by domain:
//!
//! - [`commits`] — history walk + per-commit diff.
//! - [`branches`] — local / remote branch listing + CRUD + tracking counters.
//! - [`worktree`] — dirty detection, checkout, stash, abort-merge, repo state.
//! - [`merge`] — three-strategy merge.
//! - [`remote`] — push-delete + fetch-with-prune (shares credential resolution).
//! - [`common`] — tiny helpers used across modules: repo open, error mapping,
//!   ref-name validation, short-sha formatting.
//!
//! [`GixBackend`] implements [`GitBackend`] by delegating to each submodule.

use std::path::Path;

use graph_core::Commit;

use crate::backend::{
    BackendError, BranchInfo, CommitDiff, FileDiff, GitBackend, MergeResult, MergeStrategy,
    RepoStateInfo, WorkingTreeStatus,
};

mod branches;
mod commits;
mod common;
mod merge;
mod remote;
pub(crate) mod staging;
mod worktree;

#[derive(Debug, Default, Clone, Copy)]
pub struct GixBackend;

impl GitBackend for GixBackend {
    fn walk_commits(
        &self,
        repo_path: &Path,
    ) -> Result<Box<dyn Iterator<Item = Result<Commit, BackendError>> + Send>, BackendError> {
        commits::walk_commits(repo_path)
    }

    fn list_branches(&self, repo_path: &Path) -> Result<Vec<BranchInfo>, BackendError> {
        branches::list_branches(repo_path)
    }

    fn create_branch(
        &self,
        repo_path: &Path,
        name: &str,
        from: Option<&str>,
    ) -> Result<(), BackendError> {
        branches::create_branch(repo_path, name, from)
    }

    fn delete_local_branch(
        &self,
        repo_path: &Path,
        name: &str,
        force: bool,
    ) -> Result<(), BackendError> {
        branches::delete_local_branch(repo_path, name, force)
    }

    fn rename_branch(
        &self,
        repo_path: &Path,
        old_name: &str,
        new_name: &str,
    ) -> Result<(), BackendError> {
        branches::rename_branch(repo_path, old_name, new_name)
    }

    fn is_working_tree_dirty(&self, repo_path: &Path) -> Result<bool, BackendError> {
        worktree::is_working_tree_dirty(repo_path)
    }

    fn checkout_branch(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        worktree::checkout_branch(repo_path, name)
    }

    fn stash_push(&self, repo_path: &Path, message: Option<&str>) -> Result<(), BackendError> {
        worktree::stash_push(repo_path, message)
    }

    fn stash_pop(&self, repo_path: &Path) -> Result<(), BackendError> {
        worktree::stash_pop(repo_path)
    }

    fn merge_branch(
        &self,
        repo_path: &Path,
        source: &str,
        strategy: MergeStrategy,
    ) -> Result<MergeResult, BackendError> {
        merge::merge_branch(repo_path, source, strategy)
    }

    fn delete_remote_branch(
        &self,
        repo_path: &Path,
        remote: &str,
        name: &str,
    ) -> Result<(), BackendError> {
        remote::delete_remote_branch(repo_path, remote, name)
    }

    fn abort_merge(&self, repo_path: &Path) -> Result<(), BackendError> {
        worktree::abort_merge(repo_path)
    }

    fn repo_state(&self, repo_path: &Path) -> Result<RepoStateInfo, BackendError> {
        worktree::repo_state(repo_path)
    }

    fn fetch_prune(&self, repo_path: &Path, remote: Option<&str>) -> Result<(), BackendError> {
        remote::fetch_prune(repo_path, remote)
    }

    fn commit_diff(&self, repo_path: &Path, sha: &str) -> Result<CommitDiff, BackendError> {
        commits::commit_diff(repo_path, sha)
    }

    fn working_tree_status(&self, repo_path: &Path) -> Result<WorkingTreeStatus, BackendError> {
        staging::working_tree_status(repo_path)
    }

    fn stage_files(&self, repo_path: &Path, paths: &[String]) -> Result<(), BackendError> {
        staging::stage_files(repo_path, paths)
    }

    fn unstage_files(&self, repo_path: &Path, paths: &[String]) -> Result<(), BackendError> {
        staging::unstage_files(repo_path, paths)
    }

    fn diff_unstaged(&self, repo_path: &Path, path: &str) -> Result<FileDiff, BackendError> {
        staging::diff_unstaged(repo_path, path)
    }

    fn diff_staged(&self, repo_path: &Path, path: &str) -> Result<FileDiff, BackendError> {
        staging::diff_staged(repo_path, path)
    }

    fn commit_staged(&self, repo_path: &Path, message: &str) -> Result<String, BackendError> {
        staging::commit_staged(repo_path, message)
    }

    fn amend_commit(&self, repo_path: &Path, message: &str) -> Result<String, BackendError> {
        staging::amend_commit(repo_path, message)
    }

    fn head_commit_message(&self, repo_path: &Path) -> Result<String, BackendError> {
        staging::head_commit_message(repo_path)
    }
}
