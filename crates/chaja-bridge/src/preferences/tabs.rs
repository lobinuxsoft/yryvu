// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tab system state (issue #203, umbrella #135). Mirrors GK's
//! `tabInfo` envelope at bundle:2373-2381 — the persisted shape that
//! restores the tab strip on cold start.
//!
//! Lives in its own module so the top-level [`super::Preferences`]
//! envelope doesn't grow past the per-file budget.

use serde::{Deserialize, Serialize};

/// Transient tab variant. Ports GK's `tabTypes` (cited bundle:228930-228943),
/// minus CLI (no terminal in chajá) and FOCUS_VIEW (GK-proprietary).
/// REPO_MANAGEMENT lives in [`PermanentTabs`], not here — it's a singleton.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum Tab {
    #[serde(rename = "REPO", rename_all = "camelCase")]
    Repo {
        id: String,
        repo_path: String,
        #[serde(default)]
        is_worktree: bool,
    },
    #[serde(rename = "NEW", rename_all = "camelCase")]
    New { id: String },
    #[serde(rename = "RELEASE_NOTES", rename_all = "camelCase")]
    ReleaseNotes { id: String, version: String },
}

/// Singleton state for a permanent tab. Only `closed` matters; the type
/// and id are implied by the parent field name in [`PermanentTabs`].
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermanentTabState {
    pub closed: bool,
}

/// Permanent tabs (singletons). Currently only REPO_MANAGEMENT — FOCUS_VIEW
/// is skipped per `docs/research/gitkraken-tabs/11-out-of-scope-proprietary.md`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermanentTabs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_management: Option<PermanentTabState>,
}

/// Tab system state (issue #203, umbrella #135). Three fields persisted —
/// matches GK's `tabInfo` envelope at bundle:2373-2381. `closedTabs` is
/// deliberately NOT persisted (in-memory only — see audit doc 06).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TabsPreferences {
    #[serde(default)]
    pub tabs: Vec<Tab>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_tab_id: Option<String>,
    #[serde(default)]
    pub permanent_tabs: PermanentTabs,
}
