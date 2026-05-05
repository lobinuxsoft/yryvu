// SPDX-License-Identifier: AGPL-3.0-or-later

//! [`GitBackend`] impl for [`GixBackend`]. This file is *only* delegation —
//! every method forwards to the corresponding submodule under `repo/`.
//! Rust requires a single `impl Trait for Type` block, so we keep the
//! whole table here rather than scattering it across the submodules.

use std::path::Path;

use graph_core::Commit;

use crate::backend::{
    BackendError, BranchInfo, CombinedDiff, CommitDiff, CommitOptions, FileDiff, GitBackend,
    MergeResult, MergeStrategy, PushOptions, RepoStateInfo, ResetMode, StashInfo, SubmoduleInfo,
    TagInfo, WorkingTreeStatus, WorktreeInfo,
};

use super::{
    branches, commits, merge, patches, rebase, remote, smart_branches, staging, stashes,
    submodules, tags, worktree, worktrees, GixBackend,
};

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

    fn list_tags(&self, repo_path: &Path) -> Result<Vec<TagInfo>, BackendError> {
        tags::list_tags(repo_path)
    }

    fn list_stashes(&self, repo_path: &Path) -> Result<Vec<StashInfo>, BackendError> {
        stashes::list_stashes(repo_path)
    }

    fn list_worktrees(&self, repo_path: &Path) -> Result<Vec<WorktreeInfo>, BackendError> {
        worktrees::list_worktrees(repo_path)
    }

    fn worktree_lock(
        &self,
        repo_path: &Path,
        target_workdir: &Path,
        reason: Option<&str>,
    ) -> Result<(), BackendError> {
        worktrees::worktree_lock(repo_path, target_workdir, reason)
    }

    fn worktree_unlock(&self, repo_path: &Path, target_workdir: &Path) -> Result<(), BackendError> {
        worktrees::worktree_unlock(repo_path, target_workdir)
    }

    fn worktree_remove(&self, repo_path: &Path, target_workdir: &Path) -> Result<(), BackendError> {
        worktrees::worktree_remove(repo_path, target_workdir)
    }

    fn list_submodules(&self, repo_path: &Path) -> Result<Vec<SubmoduleInfo>, BackendError> {
        submodules::list_submodules(repo_path)
    }

    fn submodule_init(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        submodules::submodule_init(repo_path, name)
    }

    fn submodule_update(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        submodules::submodule_update(repo_path, name)
    }

    fn submodule_add(
        &self,
        repo_path: &Path,
        url: &str,
        target_path: &Path,
    ) -> Result<(), BackendError> {
        submodules::submodule_add(repo_path, url, target_path)
    }

    fn submodule_remove(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        submodules::submodule_remove(repo_path, name)
    }

    fn rebase_current_onto(
        &self,
        repo_path: &Path,
        target_branch: &str,
    ) -> Result<(), BackendError> {
        rebase::rebase_current_onto(repo_path, target_branch)
    }

    fn set_upstream(
        &self,
        repo_path: &Path,
        branch_name: &str,
        upstream: Option<&str>,
    ) -> Result<(), BackendError> {
        branches::set_upstream(repo_path, branch_name, upstream)
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

    fn checkout_remote_tracking(
        &self,
        repo_path: &Path,
        full_remote_name: &str,
    ) -> Result<(), BackendError> {
        worktree::checkout_remote_tracking(repo_path, full_remote_name)
    }

    fn checkout_commit(&self, repo_path: &Path, sha: &str) -> Result<(), BackendError> {
        worktree::checkout_commit(repo_path, sha)
    }

    fn create_tag(
        &self,
        repo_path: &Path,
        name: &str,
        sha: &str,
        message: Option<&str>,
    ) -> Result<(), BackendError> {
        tags::create_tag(repo_path, name, sha, message)
    }

    fn delete_tag(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        tags::delete_tag(repo_path, name)
    }

    fn annotate_tag(
        &self,
        repo_path: &Path,
        name: &str,
        message: &str,
    ) -> Result<(), BackendError> {
        tags::annotate_tag(repo_path, name, message)
    }

    fn push_tag(&self, repo_path: &Path, remote: &str, name: &str) -> Result<(), BackendError> {
        remote::push_tag(repo_path, remote, name)
    }

    fn delete_tag_remote(
        &self,
        repo_path: &Path,
        remote: &str,
        name: &str,
    ) -> Result<(), BackendError> {
        remote::delete_tag_remote(repo_path, remote, name)
    }

    fn list_remotes(&self, repo_path: &Path) -> Result<Vec<String>, BackendError> {
        remote::list_remotes(repo_path)
    }

    fn add_remote(&self, repo_path: &Path, name: &str, url: &str) -> Result<(), BackendError> {
        remote::add_remote(repo_path, name, url)
    }

    fn remove_remote(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        remote::remove_remote(repo_path, name)
    }

    fn set_remote_url(&self, repo_path: &Path, name: &str, url: &str) -> Result<(), BackendError> {
        remote::set_remote_url(repo_path, name, url)
    }

    fn reset_to_commit(
        &self,
        repo_path: &Path,
        sha: &str,
        mode: ResetMode,
    ) -> Result<(), BackendError> {
        worktree::reset_to_commit(repo_path, sha, mode)
    }

    fn cherry_pick_commit(&self, repo_path: &Path, sha: &str) -> Result<(), BackendError> {
        worktree::cherry_pick_commit(repo_path, sha)
    }

    fn revert_commit(&self, repo_path: &Path, sha: &str) -> Result<(), BackendError> {
        worktree::revert_commit(repo_path, sha)
    }

    fn format_patch(
        &self,
        repo_path: &Path,
        sha: &str,
        out_dir: &Path,
    ) -> Result<String, BackendError> {
        patches::format_patch(repo_path, sha, out_dir)
    }

    fn stash_push(&self, repo_path: &Path, message: Option<&str>) -> Result<(), BackendError> {
        worktree::stash_push(repo_path, message)
    }

    fn stash_pop(&self, repo_path: &Path) -> Result<(), BackendError> {
        worktree::stash_pop(repo_path)
    }

    fn stash_pop_at(&self, repo_path: &Path, index: usize) -> Result<(), BackendError> {
        worktree::stash_pop_at(repo_path, index)
    }

    fn stash_apply(&self, repo_path: &Path, index: usize) -> Result<(), BackendError> {
        worktree::stash_apply(repo_path, index)
    }

    fn stash_drop(&self, repo_path: &Path, index: usize) -> Result<(), BackendError> {
        worktree::stash_drop(repo_path, index)
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

    fn get_remote_url(&self, repo_path: &Path, remote_name: &str) -> Result<String, BackendError> {
        remote::get_remote_url(repo_path, remote_name)
    }

    fn commit_diff(&self, repo_path: &Path, sha: &str) -> Result<CommitDiff, BackendError> {
        commits::commit_diff(repo_path, sha)
    }

    fn combined_commit_diff(
        &self,
        repo_path: &Path,
        shas: &[String],
        include_workdir: bool,
    ) -> Result<CombinedDiff, BackendError> {
        commits::combined_commit_diff(repo_path, shas, include_workdir)
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

    fn stage_all(&self, repo_path: &Path) -> Result<Vec<String>, BackendError> {
        staging::stage_all(repo_path)
    }

    fn unstage_all(&self, repo_path: &Path) -> Result<Vec<String>, BackendError> {
        staging::unstage_all(repo_path)
    }

    fn discard_paths(&self, repo_path: &Path, paths: &[String]) -> Result<(), BackendError> {
        staging::discard_paths(repo_path, paths)
    }

    fn create_commit(
        &self,
        repo_path: &Path,
        opts: &CommitOptions,
    ) -> Result<String, BackendError> {
        staging::create_commit(repo_path, opts)
    }

    fn commit_and_push(
        &self,
        repo_path: &Path,
        opts: &CommitOptions,
    ) -> Result<String, BackendError> {
        staging::commit_and_push(repo_path, opts)
    }

    fn smart_visible_refs(
        &self,
        repo_path: &Path,
        profile_default: Option<&str>,
    ) -> Result<Vec<String>, BackendError> {
        smart_branches::smart_visible_refs(repo_path, profile_default)
    }

    fn push(&self, repo_path: &Path, opts: PushOptions) -> Result<(), BackendError> {
        remote::push_current_branch(repo_path, opts)
    }

    fn pull(
        &self,
        repo_path: &Path,
        remote_arg: Option<&str>,
        strategy: MergeStrategy,
    ) -> Result<MergeResult, BackendError> {
        remote::pull(repo_path, remote_arg, strategy)
    }

    fn force_pull(&self, repo_path: &Path) -> Result<(), BackendError> {
        remote::force_pull(repo_path)
    }

    fn stash_count(&self, repo_path: &Path) -> Result<u32, BackendError> {
        worktree::stash_count(repo_path)
    }
}
