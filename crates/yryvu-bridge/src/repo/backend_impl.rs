// SPDX-License-Identifier: AGPL-3.0-or-later

//! [`GitBackend`] impl for [`GixBackend`]. This file is *only* delegation —
//! every method forwards to the corresponding submodule under `repo/`.
//! Rust requires a single `impl Trait for Type` block, so we keep the
//! whole table here rather than scattering it across the submodules.
//!
//! **400-LOC cap exception**: this is one trait impl of ~80 one-line
//! delegations — a contract table, not coupled logic. Rust cannot split a
//! single trait impl across files; the only alternative (decomposing
//! `GitBackend` into per-domain supertraits) would ripple a `use` change
//! through ~17 call sites for no behavioural gain. The volume is the
//! method count, so the file stays whole by design.

use std::path::Path;

use graph_core::Commit;

use crate::backend::{
    ApplyPatchOutcome, AuthorInfo, BackendError, BranchInfo, CommitDiff, CommitOptions,
    FetchReport, FileDiff, GenerateKeyRequest, GeneratedKey, GitBackend, GpgKeyInfo, LineRange,
    MergeResult, MergeStrategy, PushOptions, RemoteInfo, RepoStateInfo, ResetMode, SignConfig,
    SignFormat, StashInfo, SubmoduleInfo, TagInfo, WorkingTreeStatus, WorktreeInfo,
};

use super::{
    branches, commits, merge, patches, rebase, remote, smart_branches, staging, stashes,
    submodules, tags, worktree, worktrees, GixBackend,
};

impl GitBackend for GixBackend {
    fn walk_commits(
        &self,
        repo_path: &Path,
        limit: Option<usize>,
    ) -> Result<Box<dyn Iterator<Item = Result<Commit, BackendError>> + Send>, BackendError> {
        commits::walk_commits(repo_path, limit)
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

    fn stash_diff(
        &self,
        repo_path: &Path,
        index: usize,
    ) -> Result<crate::backend::CommitDiff, BackendError> {
        stashes::stash_diff(repo_path, index)
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

    fn worktree_add(
        &self,
        repo_path: &Path,
        path: &Path,
        branch: &str,
        base: Option<&str>,
        create_branch: bool,
    ) -> Result<(), BackendError> {
        worktrees::worktree_add(repo_path, path, branch, base, create_branch)
    }

    fn worktree_prune(&self, repo_path: &Path) -> Result<usize, BackendError> {
        worktrees::worktree_prune(repo_path)
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
        branch: Option<&str>,
        name: Option<&str>,
    ) -> Result<(), BackendError> {
        submodules::submodule_add(repo_path, url, target_path, branch, name)
    }

    fn submodule_remove(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        submodules::submodule_remove(repo_path, name)
    }

    fn submodule_sync(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        submodules::submodule_sync(repo_path, name)
    }

    fn submodule_reset(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        submodules::submodule_reset(repo_path, name)
    }

    fn submodule_deinit(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        submodules::submodule_deinit(repo_path, name)
    }

    fn rebase_current_onto(
        &self,
        repo_path: &Path,
        target_branch: &str,
    ) -> Result<(), BackendError> {
        rebase::rebase_current_onto(repo_path, target_branch)
    }

    fn list_commits_for_rebase(
        &self,
        repo_path: &Path,
        upstream: &str,
    ) -> Result<Vec<crate::repo::rebase::interactive::CommitSummary>, BackendError> {
        rebase::interactive::list_commits_for_rebase(repo_path, upstream)
    }

    fn begin_interactive_rebase(
        &self,
        repo_path: &Path,
        plan: crate::repo::rebase::interactive::RebasePlan,
    ) -> Result<crate::repo::rebase::interactive::RebaseState, BackendError> {
        rebase::interactive::begin_rebase(repo_path, plan)
    }

    fn continue_interactive_rebase(
        &self,
        repo_path: &Path,
    ) -> Result<crate::repo::rebase::interactive::RebaseState, BackendError> {
        rebase::interactive::continue_rebase(repo_path)
    }

    fn skip_interactive_rebase_step(
        &self,
        repo_path: &Path,
    ) -> Result<crate::repo::rebase::interactive::RebaseState, BackendError> {
        rebase::interactive::skip_step(repo_path)
    }

    fn abort_interactive_rebase(&self, repo_path: &Path) -> Result<(), BackendError> {
        rebase::interactive::abort_rebase(repo_path)
    }

    fn get_interactive_rebase_state(
        &self,
        repo_path: &Path,
    ) -> Result<Option<crate::repo::rebase::interactive::RebaseState>, BackendError> {
        rebase::interactive::get_state(repo_path)
    }

    fn list_conflicts(
        &self,
        repo_path: &Path,
    ) -> Result<crate::repo::conflicts::ConflictListing, BackendError> {
        crate::repo::conflicts::list_conflicts(repo_path)
    }

    fn read_conflict_diff3(
        &self,
        repo_path: &Path,
        path: &str,
    ) -> Result<crate::repo::conflicts::ConflictDiff3, BackendError> {
        crate::repo::conflicts::read_diff3(repo_path, path)
    }

    fn accept_conflict_side(
        &self,
        repo_path: &Path,
        path: &str,
        side: crate::repo::conflicts::ConflictSide,
    ) -> Result<(), BackendError> {
        crate::repo::conflicts::accept_side(repo_path, path, side)
    }

    fn resolve_conflict_with_content(
        &self,
        repo_path: &Path,
        path: &str,
        content: &str,
    ) -> Result<(), BackendError> {
        crate::repo::conflicts::resolve_with_content(repo_path, path, content)
    }

    fn mark_conflict_resolved(&self, repo_path: &Path, path: &str) -> Result<(), BackendError> {
        crate::repo::conflicts::mark_resolved(repo_path, path)
    }

    fn finish_in_progress_op(
        &self,
        repo_path: &Path,
    ) -> Result<crate::repo::conflicts::ConflictSource, BackendError> {
        crate::repo::conflicts::finish_in_progress(repo_path)
    }

    fn build_search_index(
        &self,
        repo_path: &Path,
    ) -> Result<crate::repo::search::IndexCounts, BackendError> {
        crate::repo::search::build_index(repo_path)
    }

    fn search_repo(
        &self,
        repo_path: &Path,
        mode: crate::repo::search::SearchMode,
        query: &str,
        limit: Option<u32>,
    ) -> Result<Vec<crate::repo::search::SearchHit>, BackendError> {
        crate::repo::search::search(repo_path, mode, query, limit)
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

    fn add_remote(&self, repo_path: &Path, name: &str, url: &str) -> Result<(), BackendError> {
        remote::add_remote(repo_path, name, url)
    }

    fn remove_remote(&self, repo_path: &Path, name: &str) -> Result<(), BackendError> {
        remote::remove_remote(repo_path, name)
    }

    fn set_remote_url(&self, repo_path: &Path, name: &str, url: &str) -> Result<(), BackendError> {
        remote::set_remote_url(repo_path, name, url)
    }

    fn list_remotes_detailed(&self, repo_path: &Path) -> Result<Vec<RemoteInfo>, BackendError> {
        remote::list_remotes_detailed(repo_path)
    }

    fn rename_remote(
        &self,
        repo_path: &Path,
        old_name: &str,
        new_name: &str,
    ) -> Result<Vec<String>, BackendError> {
        remote::rename_remote(repo_path, old_name, new_name)
    }

    fn set_remote_push_url(
        &self,
        repo_path: &Path,
        name: &str,
        url: Option<&str>,
    ) -> Result<(), BackendError> {
        remote::set_remote_push_url(repo_path, name, url)
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

    fn cherry_pick_commits_onto(
        &self,
        repo_path: &Path,
        shas: &[&str],
        target_branch: Option<&str>,
    ) -> Result<(), BackendError> {
        worktree::cherry_pick_commits_onto(repo_path, shas, target_branch)
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

    fn apply_patch(
        &self,
        repo_path: &Path,
        patch_path: &Path,
        committer: Option<(&str, &str)>,
    ) -> Result<ApplyPatchOutcome, BackendError> {
        patches::apply_patch(repo_path, patch_path, committer)
    }

    fn stash_push(
        &self,
        repo_path: &Path,
        message: Option<&str>,
        include_untracked: bool,
        include_ignored: bool,
    ) -> Result<(), BackendError> {
        worktree::stash_push(repo_path, message, include_untracked, include_ignored)
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

    fn fetch_prune(
        &self,
        repo_path: &Path,
        remote: Option<&str>,
    ) -> Result<FetchReport, BackendError> {
        remote::fetch_prune(repo_path, remote)
    }

    fn get_remote_url(&self, repo_path: &Path, remote_name: &str) -> Result<String, BackendError> {
        remote::get_remote_url(repo_path, remote_name)
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

    fn stage_hunks(
        &self,
        repo_path: &Path,
        path: &str,
        hunk_indices: &[usize],
    ) -> Result<(), BackendError> {
        staging::stage_hunks(repo_path, path, hunk_indices)
    }

    fn unstage_hunks(
        &self,
        repo_path: &Path,
        path: &str,
        hunk_indices: &[usize],
    ) -> Result<(), BackendError> {
        staging::unstage_hunks(repo_path, path, hunk_indices)
    }

    fn discard_hunks(
        &self,
        repo_path: &Path,
        path: &str,
        hunk_indices: &[usize],
    ) -> Result<(), BackendError> {
        staging::discard_hunks(repo_path, path, hunk_indices)
    }

    fn stage_lines(
        &self,
        repo_path: &Path,
        path: &str,
        ranges: &[LineRange],
    ) -> Result<(), BackendError> {
        staging::stage_lines(repo_path, path, ranges)
    }

    fn unstage_lines(
        &self,
        repo_path: &Path,
        path: &str,
        ranges: &[LineRange],
    ) -> Result<(), BackendError> {
        staging::unstage_lines(repo_path, path, ranges)
    }

    fn discard_lines(
        &self,
        repo_path: &Path,
        path: &str,
        ranges: &[LineRange],
    ) -> Result<(), BackendError> {
        staging::discard_lines(repo_path, path, ranges)
    }

    fn commit_sign_config(&self, repo_path: &Path) -> Result<SignConfig, BackendError> {
        staging::inspect_sign_config(repo_path)
    }

    fn export_gpg_public_key(&self, selector: &str) -> Result<String, BackendError> {
        staging::export_gpg_public_key(selector)
    }

    fn list_gpg_keys(&self) -> Result<Vec<GpgKeyInfo>, BackendError> {
        staging::list_gpg_keys()
    }

    fn recent_authors(
        &self,
        repo_path: &Path,
        limit: usize,
    ) -> Result<Vec<AuthorInfo>, BackendError> {
        commits::recent_authors(repo_path, limit)
    }

    fn generate_gpg_key(&self, req: &GenerateKeyRequest) -> Result<GeneratedKey, BackendError> {
        staging::generate_gpg_key(req)
    }

    fn set_signing_key(
        &self,
        repo_path: &Path,
        key: &str,
        format: SignFormat,
    ) -> Result<(), BackendError> {
        staging::set_signing_key(repo_path, key, format)
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
