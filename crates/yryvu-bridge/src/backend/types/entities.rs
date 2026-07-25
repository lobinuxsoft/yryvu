// SPDX-License-Identifier: AGPL-3.0-or-later

//! UI-facing entity types: branches, tags, stashes, worktrees,
//! submodules, and full commit metadata.

use serde::Serialize;

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
    /// Whether the worktree's own working tree has uncommitted changes
    /// (tracked or untracked). Drives the extra "you'll lose work"
    /// warning in the remove-confirmation dialog (issue #20).
    pub dirty: bool,
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
    /// Whether the submodule's working tree has uncommitted changes
    /// (tracked or untracked). Always `false` for uninitialized
    /// submodules — there's no working tree to inspect. Drives the
    /// dirty badge + the sidebar warning banner (issue #98).
    pub is_dirty: bool,
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
