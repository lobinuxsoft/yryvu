// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use graph_core::Commit;

use super::errors::BackendError;
use super::types::{
    BranchInfo, CombinedDiff, CommitDiff, FileDiff, MergeResult, MergeStrategy, PushOptions,
    RepoStateInfo, ResetMode, StashInfo, SubmoduleInfo, TagInfo, WorktreeInfo,
};
use crate::repo::staging::{CommitOptions, LineRange, WorkingTreeStatus};

/// Shared surface every Git backend must implement.
///
/// `gix` is the primary backend; `git2-rs` / shell-out variants exist to cover operations
/// not yet production-ready in gitoxide (e.g. interactive rebase — issue #11).
pub trait GitBackend: Send + Sync {
    fn walk_commits(
        &self,
        repo_path: &Path,
    ) -> Result<Box<dyn Iterator<Item = Result<Commit, BackendError>> + Send>, BackendError>;

    fn list_branches(&self, repo_path: &Path) -> Result<Vec<BranchInfo>, BackendError>;

    /// List every tag (lightweight + annotated) under `refs/tags/`. See
    /// [`TagInfo`] for the per-tag schema and [`crate::repo::tags::list_tags`]
    /// for the gix-backed implementation.
    fn list_tags(&self, repo_path: &Path) -> Result<Vec<TagInfo>, BackendError>;

    /// List every stash entry by walking the reflog of `refs/stash`,
    /// newest-first. Returns an empty Vec when there is no `refs/stash`
    /// (no stashes ever taken in this repo). See [`StashInfo`].
    fn list_stashes(&self, repo_path: &Path) -> Result<Vec<StashInfo>, BackendError>;

    /// Enumerate the main worktree plus every linked worktree under
    /// `.git/worktrees/`. The first row is always the main worktree.
    /// See [`WorktreeInfo`].
    fn list_worktrees(&self, repo_path: &Path) -> Result<Vec<WorktreeInfo>, BackendError>;

    /// Enumerate every submodule declared in `.gitmodules`. Returns an
    /// empty Vec for repos without submodules. See [`SubmoduleInfo`].
    fn list_submodules(&self, repo_path: &Path) -> Result<Vec<SubmoduleInfo>, BackendError>;

    fn create_branch(
        &self,
        repo_path: &Path,
        name: &str,
        from: Option<&str>,
    ) -> Result<(), BackendError>;

    fn delete_local_branch(
        &self,
        repo_path: &Path,
        name: &str,
        force: bool,
    ) -> Result<(), BackendError>;

    fn rename_branch(
        &self,
        repo_path: &Path,
        old_name: &str,
        new_name: &str,
    ) -> Result<(), BackendError>;

    fn is_working_tree_dirty(&self, repo_path: &Path) -> Result<bool, BackendError>;

    fn checkout_branch(&self, repo_path: &Path, name: &str) -> Result<(), BackendError>;

    /// Checkout a remote-tracking branch by creating-or-switching to a
    /// local branch that tracks it. Powers `Checkout` on a remote
    /// branch row.
    fn checkout_remote_tracking(
        &self,
        repo_path: &Path,
        full_remote_name: &str,
    ) -> Result<(), BackendError>;

    /// Detach HEAD to the given commit SHA. Caller is expected to prompt on a
    /// dirty working tree beforehand; the default git2 checkout refuses to
    /// overwrite uncommitted changes.
    fn checkout_commit(&self, repo_path: &Path, sha: &str) -> Result<(), BackendError>;

    /// Create a tag pointing at `sha`. When `message` is `Some`, a proper
    /// annotated tag object is written; when `None`, a lightweight tag ref
    /// is created instead.
    fn create_tag(
        &self,
        repo_path: &Path,
        name: &str,
        sha: &str,
        message: Option<&str>,
    ) -> Result<(), BackendError>;

    /// Delete a local tag (`refs/tags/<name>`). Doesn't touch remotes —
    /// see backend impl notes for the remote-side counterpart.
    fn delete_tag(&self, repo_path: &Path, name: &str) -> Result<(), BackendError>;

    /// Convert a lightweight tag to an annotated one (or rewrite an
    /// existing annotated tag) at the same target SHA.
    fn annotate_tag(&self, repo_path: &Path, name: &str, message: &str)
        -> Result<(), BackendError>;

    /// Push a local tag to a remote (`refs/tags/<name>:refs/tags/<name>`).
    fn push_tag(&self, repo_path: &Path, remote: &str, name: &str) -> Result<(), BackendError>;

    /// Delete a tag on a remote (`:refs/tags/<name>`). Doesn't touch
    /// the local copy.
    fn delete_tag_remote(
        &self,
        repo_path: &Path,
        remote: &str,
        name: &str,
    ) -> Result<(), BackendError>;

    /// Enumerate configured remote names. The tag-menu `Delete from
    /// all remotes` and `Push to remote` items branch on the count.
    fn list_remotes(&self, repo_path: &Path) -> Result<Vec<String>, BackendError>;

    /// Register a new remote pointing at `url`. Powers the
    /// `Add remote…` action on the REMOTE-header context menu (#227).
    fn add_remote(&self, repo_path: &Path, name: &str, url: &str) -> Result<(), BackendError>;

    /// Remove a configured remote (entry + local tracking refs).
    fn remove_remote(&self, repo_path: &Path, name: &str) -> Result<(), BackendError>;

    /// Update the fetch URL of an existing remote.
    fn set_remote_url(&self, repo_path: &Path, name: &str, url: &str) -> Result<(), BackendError>;

    /// Reset the current branch tip to the given commit. `Hard` is destructive
    /// — callers MUST confirm with the user before invoking it.
    fn reset_to_commit(
        &self,
        repo_path: &Path,
        sha: &str,
        mode: ResetMode,
    ) -> Result<(), BackendError>;

    /// Apply the diff introduced by `sha` on top of HEAD as a new commit.
    /// Leaves the repo in cherry-pick state with `MergeConflict` on conflicts.
    fn cherry_pick_commit(&self, repo_path: &Path, sha: &str) -> Result<(), BackendError>;

    /// Create an inverse commit that undoes `sha`. Leaves the repo in revert
    /// state with `MergeConflict` on conflicts.
    fn revert_commit(&self, repo_path: &Path, sha: &str) -> Result<(), BackendError>;

    /// Emit a `git format-patch -1 <sha>` equivalent mbox-style `.patch` file
    /// into `out_dir`. Returns the absolute path of the created file.
    fn format_patch(
        &self,
        repo_path: &Path,
        sha: &str,
        out_dir: &Path,
    ) -> Result<String, BackendError>;

    fn stash_push(&self, repo_path: &Path, message: Option<&str>) -> Result<(), BackendError>;

    fn stash_pop(&self, repo_path: &Path) -> Result<(), BackendError>;

    fn stash_pop_at(&self, repo_path: &Path, index: usize) -> Result<(), BackendError>;

    fn stash_apply(&self, repo_path: &Path, index: usize) -> Result<(), BackendError>;

    fn stash_drop(&self, repo_path: &Path, index: usize) -> Result<(), BackendError>;

    fn worktree_lock(
        &self,
        repo_path: &Path,
        target_workdir: &Path,
        reason: Option<&str>,
    ) -> Result<(), BackendError>;

    fn worktree_unlock(&self, repo_path: &Path, target_workdir: &Path) -> Result<(), BackendError>;

    fn worktree_remove(&self, repo_path: &Path, target_workdir: &Path) -> Result<(), BackendError>;

    fn submodule_init(&self, repo_path: &Path, name: &str) -> Result<(), BackendError>;

    fn submodule_update(&self, repo_path: &Path, name: &str) -> Result<(), BackendError>;

    fn submodule_add(
        &self,
        repo_path: &Path,
        url: &str,
        target_path: &Path,
    ) -> Result<(), BackendError>;

    fn submodule_remove(&self, repo_path: &Path, name: &str) -> Result<(), BackendError>;

    /// Rebase the current branch onto `target_branch`. Aborts on
    /// conflict (chajá doesn't yet expose per-step rebase resolution).
    fn rebase_current_onto(
        &self,
        repo_path: &Path,
        target_branch: &str,
    ) -> Result<(), BackendError>;

    /// Set or clear the upstream tracking config for `branch_name`.
    /// `Some("origin/main")` tracks a specific remote ref; `None`
    /// clears the tracking config.
    fn set_upstream(
        &self,
        repo_path: &Path,
        branch_name: &str,
        upstream: Option<&str>,
    ) -> Result<(), BackendError>;

    fn merge_branch(
        &self,
        repo_path: &Path,
        source: &str,
        strategy: MergeStrategy,
    ) -> Result<MergeResult, BackendError>;

    fn delete_remote_branch(
        &self,
        repo_path: &Path,
        remote: &str,
        name: &str,
    ) -> Result<(), BackendError>;

    fn abort_merge(&self, repo_path: &Path) -> Result<(), BackendError>;

    fn repo_state(&self, repo_path: &Path) -> Result<RepoStateInfo, BackendError>;

    fn fetch_prune(&self, repo_path: &Path, remote: Option<&str>) -> Result<(), BackendError>;

    /// Resolve the fetch URL of a configured remote. Powers the
    /// `Copy URL` action on remote-branch / remote-header context menus.
    fn get_remote_url(&self, repo_path: &Path, remote_name: &str) -> Result<String, BackendError>;

    fn commit_diff(&self, repo_path: &Path, sha: &str) -> Result<CommitDiff, BackendError>;

    /// Multi-revision / WIP-aware diff for the right-panel inspector.
    /// `shas` is ordered youngest-first (graph-row order). `include_workdir`
    /// extends the comparison's new-side to the working tree (staged + unstaged
    /// merged). The resulting [`CombinedDiff::kind`] tells the frontend which
    /// inspector header to render — see [`super::types::CombinedDiffKind`].
    fn combined_commit_diff(
        &self,
        repo_path: &Path,
        shas: &[String],
        include_workdir: bool,
    ) -> Result<CombinedDiff, BackendError>;

    fn working_tree_status(&self, repo_path: &Path) -> Result<WorkingTreeStatus, BackendError>;

    fn stage_files(&self, repo_path: &Path, paths: &[String]) -> Result<(), BackendError>;

    fn unstage_files(&self, repo_path: &Path, paths: &[String]) -> Result<(), BackendError>;

    fn diff_unstaged(&self, repo_path: &Path, path: &str) -> Result<FileDiff, BackendError>;

    fn diff_staged(&self, repo_path: &Path, path: &str) -> Result<FileDiff, BackendError>;

    fn commit_staged(&self, repo_path: &Path, message: &str) -> Result<String, BackendError>;

    fn amend_commit(&self, repo_path: &Path, message: &str) -> Result<String, BackendError>;

    fn head_commit_message(&self, repo_path: &Path) -> Result<String, BackendError>;

    /// Stage every unstaged change (mods + deletes + untracked) in one shot.
    /// Returns the paths that were staged.
    fn stage_all(&self, repo_path: &Path) -> Result<Vec<String>, BackendError>;

    /// Reset every staged entry back to HEAD. Returns the paths that were
    /// unstaged.
    fn unstage_all(&self, repo_path: &Path) -> Result<Vec<String>, BackendError>;

    /// Destructively revert workdir changes for `paths` — tracked paths
    /// snap back to HEAD, untracked files are removed. The index is not
    /// touched.
    fn discard_paths(&self, repo_path: &Path, paths: &[String]) -> Result<(), BackendError>;

    /// Stage only the selected hunks of `path`. Forward-applies a synthetic
    /// patch to the index; the workdir is unchanged.
    fn stage_hunks(
        &self,
        repo_path: &Path,
        path: &str,
        hunk_indices: &[usize],
    ) -> Result<(), BackendError>;

    /// Unstage only the selected hunks of `path`, rolling those changes
    /// back to HEAD in the index.
    fn unstage_hunks(
        &self,
        repo_path: &Path,
        path: &str,
        hunk_indices: &[usize],
    ) -> Result<(), BackendError>;

    /// Discard only the selected hunks of `path` from the workdir. The
    /// caller MUST confirm — there is no undo.
    fn discard_hunks(
        &self,
        repo_path: &Path,
        path: &str,
        hunk_indices: &[usize],
    ) -> Result<(), BackendError>;

    /// Stage only the selected lines (per-hunk indices) of `path`.
    fn stage_lines(
        &self,
        repo_path: &Path,
        path: &str,
        ranges: &[LineRange],
    ) -> Result<(), BackendError>;

    /// Unstage only the selected lines of `path`.
    fn unstage_lines(
        &self,
        repo_path: &Path,
        path: &str,
        ranges: &[LineRange],
    ) -> Result<(), BackendError>;

    /// Discard only the selected lines of `path` from the workdir.
    fn discard_lines(
        &self,
        repo_path: &Path,
        path: &str,
        ranges: &[LineRange],
    ) -> Result<(), BackendError>;

    /// Write a commit (or amend HEAD) from the bundled options. Returns the
    /// new commit SHA.
    fn create_commit(&self, repo_path: &Path, opts: &CommitOptions)
        -> Result<String, BackendError>;

    /// Commit then push current branch to its upstream (creating one at
    /// `origin/<branch>` when absent). Returns the new commit SHA; the
    /// commit survives a push failure.
    fn commit_and_push(
        &self,
        repo_path: &Path,
        opts: &CommitOptions,
    ) -> Result<String, BackendError>;

    /// Resolve the visible-ref allowlist for `Smart Branch Visibility`.
    /// Empty result means "do not apply" (detached HEAD, unborn HEAD, or
    /// repo open failure). `profile_default` mirrors GK's profile-wide
    /// `init.defaultBranch` setting; pass [`None`] when chajá has no
    /// profile-level override.
    fn smart_visible_refs(
        &self,
        repo_path: &Path,
        profile_default: Option<&str>,
    ) -> Result<Vec<String>, BackendError>;

    /// Push HEAD's branch to its configured upstream (or `origin/<branch>`
    /// when absent). Honors `PushOptions::force_with_lease`.
    fn push(&self, repo_path: &Path, opts: PushOptions) -> Result<(), BackendError>;

    /// Pull (fetch + merge) the upstream of HEAD's branch. `remote` is
    /// `None` for "use the upstream's remote" (the typical case); set it
    /// when the user explicitly picks a different remote in the toolbar
    /// dropdown. `strategy` controls fast-forward vs merge-commit.
    fn pull(
        &self,
        repo_path: &Path,
        remote: Option<&str>,
        strategy: MergeStrategy,
    ) -> Result<MergeResult, BackendError>;

    /// Hard-reset HEAD to its upstream, fetching first. Destructive —
    /// drops any local commits not reachable from the upstream. Refuses
    /// on detached HEAD or when no upstream is configured.
    fn force_pull(&self, repo_path: &Path) -> Result<(), BackendError>;

    /// Count entries in the stash queue. The toolbar's Pop button gates
    /// on this (`> 0`) to avoid the libgit2 "no stash" error that fires
    /// when popping an empty queue.
    fn stash_count(&self, repo_path: &Path) -> Result<u32, BackendError>;
}
