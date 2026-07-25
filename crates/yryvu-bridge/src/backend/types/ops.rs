// SPDX-License-Identifier: AGPL-3.0-or-later

//! Operation inputs and results: reset mode, push options, merge
//! strategy/result, repo state, and apply-patch outcome.

use serde::Serialize;

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
#[derive(Debug, Clone, Serialize)]
pub struct RepoStateInfo {
    /// One of: `clean` / `merge` / `rebase` / `cherry-pick` / `revert` /
    /// `bisect` / `apply-mailbox`.
    pub kind: String,
    /// Paths with conflict markers. Empty unless the index has conflicts.
    pub conflict_paths: Vec<String>,
}

/// Result of applying an mbox `.patch` (`git am` equivalent, issue #75).
/// Serialized field names (`new_sha`, `subject`) are the frontend contract.
#[derive(Debug, Clone, Serialize)]
pub struct ApplyPatchOutcome {
    /// SHA of the commit the patch materialized on HEAD.
    pub new_sha: String,
    /// Commit subject (the `Subject:` header, `[PATCH]` prefix stripped).
    pub subject: String,
}
