// SPDX-License-Identifier: AGPL-3.0-or-later

//! Plan / state types for interactive rebase. String enums match the
//! literals git uses in `git-rebase-todo` so the same vocabulary works
//! end-to-end (UI → IPC → backend → reflog messages).

use serde::{Deserialize, Serialize};

/// Per-commit action in an interactive rebase plan. Lowercase matches
/// the literals git uses in `git-rebase-todo` (`pick`, `reword`, ...).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RebaseAction {
    Pick,
    Reword,
    Edit,
    Squash,
    Fixup,
    Drop,
}

/// One step of the rebase plan. `new_message` is required for `Reword`
/// (the caller pre-fills it from the picker UI); other actions ignore it.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RebaseStep {
    pub oid: String,
    pub action: RebaseAction,
    #[serde(default)]
    pub new_message: Option<String>,
}

/// Full rebase plan: rewrite `steps` (in their listed order) onto
/// `onto`. The steps are ordered oldest → newest (same direction git
/// writes the todo file).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RebasePlan {
    pub onto: String,
    pub steps: Vec<RebaseStep>,
}

/// Why the rebase is paused. `Conflict` is the only case that needs
/// user intervention; `Edit` is the explicit pause requested by the
/// plan itself.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PauseReason {
    Edit,
    Conflict,
}

/// Persisted state. Lives at `<repo>/.git/yryvu-rebase-state.json` so
/// it survives app restarts but does not collide with native
/// `.git/rebase-merge/` (this orchestrator does not use git's own
/// rebase machinery).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RebaseState {
    pub onto: String,
    pub steps: Vec<RebaseStep>,
    pub current_step: usize,
    pub original_head: String,
    pub head_branch: Option<String>,
    pub pause_reason: Option<PauseReason>,
}

/// Row in the commit picker UI. `short_oid` is precomputed so the
/// frontend does not have to slice oids itself.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CommitSummary {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
}
