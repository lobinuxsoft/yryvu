// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use graph_core::Commit;
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BackendError {
    #[error("failed to open repository at {path}: {source}")]
    Open {
        path: String,
        #[source]
        source: anyhow::Error,
    },
    #[error("revwalk failed: {0}")]
    Revwalk(#[source] anyhow::Error),
    #[error("not implemented: {0}")]
    NotImplemented(&'static str),
    #[error("branch operation failed: {0}")]
    Branch(#[source] anyhow::Error),
    #[error("branch '{name}' already exists")]
    BranchExists { name: String },
    #[error("branch '{name}' not found")]
    BranchNotFound { name: String },
    #[error("branch '{name}' is not fully merged into HEAD; pass force to delete anyway")]
    BranchUnmerged { name: String },
    #[error("invalid branch name: '{name}'")]
    InvalidBranchName { name: String },
    #[error("invalid tag name: '{name}'")]
    InvalidTagName { name: String },
    #[error("tag '{name}' already exists")]
    TagExists { name: String },
    #[error("commit '{sha}' not found")]
    CommitNotFound { sha: String },
    #[error("working tree has uncommitted changes")]
    WorkingTreeDirty,
    #[error("merge is not a fast-forward")]
    NotFastForward,
    #[error("merge produced conflicts in {paths:?}")]
    MergeConflict { paths: Vec<String> },
    #[error("remote '{name}' not found")]
    RemoteNotFound { name: String },
    #[error("push failed: {0}")]
    PushFailed(String),
    #[error("force-with-lease aborted: remote {ref_name} moved since the last fetch")]
    LeaseStale { ref_name: String },
    #[error("fetch failed: {0}")]
    FetchFailed(String),
    #[error("git operation failed: {0}")]
    Git(#[source] anyhow::Error),
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BranchKind {
    Local,
    Remote,
}

/// Branch information exposed to the UI. `name` is always the short form
/// (no `refs/heads/` or `refs/remotes/` prefix); `full_name` keeps the full ref.
#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub full_name: String,
    pub kind: BranchKind,
    pub tip_sha: String,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResetMode {
    /// Move HEAD (and branch tip) to the target; keep index and working tree.
    Soft,
    /// Move HEAD and reset the index to the target; keep working tree.
    Mixed,
    /// Move HEAD, reset index and force-checkout working tree to match target.
    /// Destructive: uncommitted changes are lost.
    Hard,
}

/// Push customisation. Currently exposes the `--force-with-lease` switch;
/// chajá deliberately does not surface a bare `--force` from the UI to keep
/// users from clobbering coworkers' commits unintentionally.
#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PushOptions {
    /// When `true`, allow a non-fast-forward push **only** if the remote tip
    /// still matches the local tracking ref. The lease check happens inside
    /// the push negotiation callback; mismatches abort with a typed error.
    #[serde(default)]
    pub force_with_lease: bool,
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MergeStrategy {
    /// Abort unless a fast-forward is possible.
    FastForwardOnly,
    /// Fast-forward when possible; otherwise create a merge commit.
    FastForwardOrMerge,
    /// Always create a merge commit, even when a fast-forward is possible.
    NoFastForward,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum MergeResult {
    AlreadyUpToDate,
    FastForward { new_head: String },
    Merged { new_head: String },
    Conflict { paths: Vec<String> },
}

/// Current state of the repository, reported to the UI so non-clean states
/// (merge / rebase / cherry-pick / …) can surface a persistent banner with
/// an abort affordance.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChange,
    Unmodified,
    Other,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LineKind {
    Context,
    Added,
    Removed,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffLine {
    pub kind: LineKind,
    pub content: String,
    pub old_line_no: Option<u32>,
    pub new_line_no: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub is_binary: bool,
    pub truncated: bool,
    pub old_size: u64,
    pub new_size: u64,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitDiff {
    pub sha: String,
    pub parent_sha: Option<String>,
    pub files: Vec<FileDiff>,
}

/// Selection variant the right-panel inspector renders. Mirrors GitKraken's
/// branching on `(selectedShas, isWorkDirSelected)` per
/// `docs/research/gitkraken-right-panel/05-stats-and-file-list.md`.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CombinedDiffKind {
    /// Single commit vs its first parent.
    Single,
    /// Two or more commits merged: diff between the first parent of the oldest
    /// commit and the tree of the youngest commit.
    Multi,
    /// Working tree (index + worktree) vs HEAD. Backend treats this as a
    /// distinct kind because the inspector header ("Viewing diff against the
    /// WIP") differs from any committed view.
    WipOnly,
    /// One commit plus the WIP: diff between the commit's tree and the
    /// working tree.
    CommitVsWip,
    /// Two or more commits plus the WIP: diff between the first parent of the
    /// oldest commit and the working tree.
    MultiVsWip,
}

/// Result of a multi-revision / WIP-aware diff. Drives the inspector's stat
/// chips, file list, and header copy in one round-trip.
#[derive(Debug, Clone, Serialize)]
pub struct CombinedDiff {
    pub kind: CombinedDiffKind,
    /// Count of committed rows in the selection. Zero for `WipOnly`.
    pub n_commits: u32,
    pub include_workdir: bool,
    /// Shas considered, youngest-first (matching the order the frontend
    /// selects rows in). Empty for `WipOnly`.
    pub shas: Vec<String>,
    pub files: Vec<FileDiff>,
}

/// Full commit metadata surfaced to the right-panel inspector.
///
/// Mirrors the fields `graph_core::Commit` emits plus pre-computed badge
/// values — `graph_core::GraphRow` carries the same data for the rows
/// currently in the stream, but the inspector can also be asked about
/// commits outside the current window (e.g. via URL deep-link), so this
/// command resolves the sha fresh against the repo rather than reading
/// from a cached row.
#[derive(Debug, Clone, Serialize)]
pub struct CommitDetail {
    pub sha: String,
    /// 6-character prefix per GitKraken's inspector (`docs/research/gitkraken-right-panel/02-commit-header.md`).
    /// `GraphRow.short_sha` stays at 7 chars for graph-row consumers that
    /// predate this struct.
    pub short_sha: String,
    pub parent_shas: Vec<String>,
    pub summary: String,
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: i64,
    pub author_initials: String,
    pub gravatar_hash: String,
    pub committer_name: Option<String>,
    pub committer_email: Option<String>,
    pub committer_date: Option<i64>,
    pub committer_initials: Option<String>,
    pub committer_gravatar_hash: Option<String>,
}

/// Maximum total diff size Chajá will materialize per file. Anything larger is
/// returned with `truncated = true` and empty `hunks`.
pub const DIFF_MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

pub use crate::repo::staging::{CommitOptions, WorkingTreeChange, WorkingTreeStatus};

#[derive(Debug, Clone, Serialize)]
pub struct RepoStateInfo {
    /// One of: `clean` / `merge` / `rebase` / `cherry-pick` / `revert` /
    /// `bisect` / `apply-mailbox`.
    pub kind: String,
    /// Paths with conflict markers. Empty unless the index has conflicts.
    pub conflict_paths: Vec<String>,
}

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

    fn commit_diff(&self, repo_path: &Path, sha: &str) -> Result<CommitDiff, BackendError>;

    /// Multi-revision / WIP-aware diff for the right-panel inspector.
    /// `shas` is ordered youngest-first (graph-row order). `include_workdir`
    /// extends the comparison's new-side to the working tree (staged + unstaged
    /// merged). The resulting [`CombinedDiff::kind`] tells the frontend which
    /// inspector header to render — see [`CombinedDiffKind`].
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

pub use crate::repo::GixBackend;
