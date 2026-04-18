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

    fn stash_push(
        &self,
        repo_path: &Path,
        message: Option<&str>,
    ) -> Result<(), BackendError>;

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
}

pub use crate::repo::GixBackend;
