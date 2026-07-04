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
    #[error("token rejected by provider (401)")]
    InvalidToken,
    #[error("insufficient scopes — granted: [{granted}], required: [{required}]")]
    InsufficientScopes { granted: String, required: String },
    #[error("rate-limited by provider; resets at unix epoch {reset_at}")]
    RateLimited { reset_at: u64 },
    #[error("network error: {detail}")]
    NetworkError { detail: String },
    #[error("OAuth flow cancelled by user")]
    OAuthCancelled,
    #[error("OAuth state mismatch (possible CSRF / replay)")]
    OAuthStateMismatch,
    #[error("OAuth flow timed out waiting for browser redirect")]
    OAuthTimeout,
    #[error("OAuth code-for-token exchange failed: {detail}")]
    OAuthExchangeFailed { detail: String },
    #[error("OAuth not configured for this provider — client_id is empty")]
    OAuthNotConfigured,
    #[error("init destination already exists: {path}")]
    InitDestExists { path: String },
    #[error("init path is invalid ({reason}): {path}")]
    InitInvalidPath { path: String, reason: String },
    #[error("template '{name}' not found in the bundled set")]
    InitTemplateMissing { name: String },
    #[error("init write failed for {path}: {source}")]
    InitWriteFailed {
        path: String,
        #[source]
        source: anyhow::Error,
    },
    #[error("clone authentication failed (no credentials accepted)")]
    CloneAuthFailed,
    #[error("clone network error: {detail}")]
    CloneNetworkError { detail: String },
    #[error("clone url is invalid: {url}")]
    CloneInvalidUrl { url: String },
    #[error("clone destination already exists or is not empty: {path}")]
    CloneDestExists { path: String },
    #[error("clone cancelled by user")]
    CloneCancelled,
    #[error("patch file is malformed: {detail}")]
    PatchParse { detail: String },
    #[error("patch does not apply cleanly to HEAD")]
    PatchDoesNotApply,
}
