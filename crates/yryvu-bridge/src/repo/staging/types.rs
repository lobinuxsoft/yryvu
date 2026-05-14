// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};

use crate::backend::FileStatus;

/// Options bundle for `create_commit`. GitKraken's commit saga passes the
/// same knobs: summary + optional description body, amend flag, skip-hooks
/// (bypass pre-commit), and GPG sign.
///
/// Notes on backend capability:
///
/// * `skip_hooks` is effectively always-on: libgit2 (which git2-rs wraps)
///   never runs pre-commit / commit-msg hooks. The field is accepted for
///   API parity with GK but is a no-op — commits always behave as if the
///   flag were set.
/// * `gpg_sign = true` returns `BackendError::NotImplemented` for now:
///   signing requires shelling out to `gpg` or a GPG-agent bridge, which
///   is tracked in a separate preferences-gated issue.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOptions {
    /// Subject line. Trimmed; empty is rejected.
    pub summary: String,
    /// Optional body. When non-empty, joined to the summary with a blank
    /// line separator (Conventional-Commit shape).
    #[serde(default)]
    pub description: String,
    /// Rewrite HEAD instead of creating a new commit (`git commit --amend`).
    /// Errors when HEAD is unborn.
    #[serde(default)]
    pub amend: bool,
    /// Bypass pre-commit / commit-msg hooks. No-op on git2 — hooks are
    /// never invoked.
    #[serde(default)]
    pub skip_hooks: bool,
    /// GPG-sign the commit. Currently unimplemented; passing `true`
    /// returns `BackendError::NotImplemented`.
    #[serde(default)]
    pub gpg_sign: bool,
}

/// A single file entry in the working-tree status view.
#[derive(Debug, Clone, Serialize)]
pub struct WorkingTreeChange {
    pub path: String,
    /// Previous path for renames/copies (staged side only).
    pub old_path: Option<String>,
    pub status: FileStatus,
}

/// Result of a working-tree scan: files split into unstaged (workdir vs index)
/// and staged (index vs HEAD) sides. The same path can appear in both when a
/// file has been partially staged.
#[derive(Debug, Clone, Serialize)]
pub struct WorkingTreeStatus {
    pub unstaged: Vec<WorkingTreeChange>,
    pub staged: Vec<WorkingTreeChange>,
}
