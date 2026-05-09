// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::Serialize;

/// Maximum total diff size Yryvu will materialize per file. Anything larger is
/// returned with `truncated = true` and empty `hunks`.
pub const DIFF_MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

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

/// Tag information exposed to the UI. `target_sha` is always the *peeled*
/// commit SHA — for annotated tags the wrapping object is decoded
/// transparently so callers can resolve the underlying commit without a
/// second round-trip. The annotated message + tagger fields are populated
/// only when `is_annotated` is true.
#[derive(Debug, Clone, Serialize)]
pub struct TagInfo {
    pub name: String,
    pub full_name: String,
    pub target_sha: String,
    pub is_annotated: bool,
    pub message: Option<String>,
    pub tagger_name: Option<String>,
    pub tagger_email: Option<String>,
    pub tagger_date: Option<i64>,
}

/// Stash entry exposed to the UI. Mirrors the per-row shape GK builds
/// in `mapStashToLeftPanelRow` — the renderer consumes `sha`, `message`,
/// and `branch_name` directly; `parent_sha` / `index_sha` /
/// `untracked_sha` come from the stash commit's parent slots so the
/// inspector can diff index-only or untracked-only views without
/// re-decoding the commit. `when` is the stash commit's committer
/// timestamp in unix seconds.
#[derive(Debug, Clone, Serialize)]
pub struct StashInfo {
    pub sha: String,
    pub message: String,
    pub branch_name: Option<String>,
    pub parent_sha: String,
    pub index_sha: Option<String>,
    pub untracked_sha: Option<String>,
    pub when: i64,
}

/// Worktree row exposed to the UI. Field set mirrors what GK's
/// `parseWorktreeList` extracts from `git worktree list --porcelain -z`
/// so the sidebar can render without massaging the data: `branch` is
/// the short HEAD ref (or the literal `HEAD` for detached worktrees),
/// `head` is the commit SHA. `is_main` flags the main worktree (the
/// only one that can be bare and that cannot be removed). `locked` and
/// `prunable` carry the raw git reasons when present.
#[derive(Debug, Clone, Serialize)]
pub struct WorktreeInfo {
    pub workdir: String,
    pub branch: String,
    pub head: Option<String>,
    pub is_main: bool,
    pub is_bare: bool,
    pub locked: Option<String>,
    pub prunable: Option<String>,
    pub main_repo_workdir: String,
}

/// Submodule row exposed to the UI. Combines what GK pulls from
/// `git submodule status` with the inner-repo open: `head_sha` is what
/// the parent's HEAD tree pins the submodule to, `index_sha` is what
/// the parent's index has staged. `ahead` / `behind` compare the
/// submodule's checked-out commit against the parent-pinned commit
/// (zero when the submodule is uninitialized or pinned matches HEAD).
/// `is_initialized` reflects gix's `state.repository_exists &&
/// state.worktree_checkout`; `is_deleted` flags the case where the
/// parent still pins a commit but the working tree directory is gone.
#[derive(Debug, Clone, Serialize)]
pub struct SubmoduleInfo {
    pub name: String,
    pub path: String,
    pub url: Option<String>,
    pub head_sha: Option<String>,
    pub index_sha: Option<String>,
    pub is_initialized: bool,
    pub is_deleted: bool,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Copy, serde::Deserialize, serde::Serialize)]
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
/// yryvu deliberately does not surface a bare `--force` from the UI to keep
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

#[derive(Debug, Clone, Serialize)]
pub struct RepoStateInfo {
    /// One of: `clean` / `merge` / `rebase` / `cherry-pick` / `revert` /
    /// `bisect` / `apply-mailbox`.
    pub kind: String,
    /// Paths with conflict markers. Empty unless the index has conflicts.
    pub conflict_paths: Vec<String>,
}
