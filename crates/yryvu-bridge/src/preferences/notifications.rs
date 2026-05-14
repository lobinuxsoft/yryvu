// SPDX-License-Identifier: AGPL-3.0-or-later

//! Notifications preferences (issue #193) — **explicit deviation from
//! GK**. The GK bundle exposes only two toggles under
//! `NotificationPreferences-*`: `Desktop` (OS-level notifications) and
//! `Marketing` (GK Pro proprietary). Neither maps onto yryvu — there is
//! no `tauri-plugin-notification` integration today and the marketing
//! channel is irrelevant.
//!
//! What yryvu *does* have, from #109 (closed completed), is an in-app
//! toaster system (`notify.success`/`.error`/`.info`/`.loading`, `Bell`,
//! `HistoryPanel`, `ToastContainer`) called from ~60+ sites across the
//! frontend. GK never exposed per-operation toggles in the
//! notifications panel, so this struct ships a yryvu-specific shape: a
//! handful of category bools that the `notify.*` API will consult in a
//! follow-up PR before emitting.
//!
//! Categories were derived from a callsite audit (grep `notify\.(success
//! |error|info|loading)` across `apps/yryvu-app/src`); each bucket
//! groups operations that share a mental model (e.g. push / pull /
//! fetch all sit under "remote sync"). Granularity is per-bucket, not
//! per-severity — a follow-up issue can split success vs error if the
//! current coarseness proves wrong in practice.
//!
//! Backend-only; the panel View and the `notify.*` consumer wiring
//! land in follow-up sub-PRs (one each per the MVP separation rule).

use serde::{Deserialize, Serialize};

/// `Preferences > Notifications` panel state (issue #193). Six bool
/// toggles, one per operation category, all defaulting to `true`
/// (notifications enabled out of the box). Toggling a category off
/// suppresses both `success` and `error` toasts for that category;
/// severity-level granularity is a follow-up if it becomes needed.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationsPreferences {
    #[serde(default = "default_true")]
    pub remote_sync_notifications: bool,
    #[serde(default = "default_true")]
    pub branch_notifications: bool,
    #[serde(default = "default_true")]
    pub commit_notifications: bool,
    #[serde(default = "default_true")]
    pub stash_notifications: bool,
    #[serde(default = "default_true")]
    pub repo_object_notifications: bool,
    #[serde(default = "default_true")]
    pub undo_redo_notifications: bool,
}

impl Default for NotificationsPreferences {
    fn default() -> Self {
        Self {
            remote_sync_notifications: true,
            branch_notifications: true,
            commit_notifications: true,
            stash_notifications: true,
            repo_object_notifications: true,
            undo_redo_notifications: true,
        }
    }
}

fn default_true() -> bool {
    true
}
