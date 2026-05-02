// SPDX-License-Identifier: AGPL-3.0-or-later

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
    #[error("remote '{name}' already exists")]
    RemoteExists { name: String },
    #[error("invalid remote name: '{name}'")]
    InvalidRemoteName { name: String },
    #[error("push failed: {0}")]
    PushFailed(String),
    #[error("force-with-lease aborted: remote {ref_name} moved since the last fetch")]
    LeaseStale { ref_name: String },
    #[error("fetch failed: {0}")]
    FetchFailed(String),
    #[error("git operation failed: {0}")]
    Git(#[source] anyhow::Error),
    #[error("'{name}' CLI not found on PATH")]
    CliNotFound { name: String },
    #[error("'{name}' CLI is not authenticated")]
    CliNotAuthenticated { name: String },
    #[error("'{name}' CLI failed: {stderr}")]
    CliFailed { name: String, stderr: String },
    #[error("OS keyring service unavailable (libsecret/Keychain/Credential Vault not running)")]
    KeyringUnavailable,
    #[error("keyring failed: {detail}")]
    KeyringFailed { detail: String },
    #[error("integrations sidecar schema version {found} not supported (max {supported})")]
    UnsupportedSidecarVersion { found: u32, supported: u32 },
}
