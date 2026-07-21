// SPDX-License-Identifier: AGPL-3.0-or-later

//! General preferences (issue #102) — port of GitKraken's
//! `GeneralPreferences` tab. Fourteen fields KEEP, ten SKIP/DEFER:
//! see the issue body for the per-field validation against
//! `app/src/strings/en-us.json` (40 strings with prefix
//! `GeneralPreferences-`).
//!
//! Backend-only; the panel View lands in a follow-up sub-PR.

use serde::{Deserialize, Serialize};

/// `Preferences > General` panel state (issue #102). Mirrors the
/// fourteen GK settings whose `GeneralPreferences-*` strings have a
/// matching control in the panel render. The eleven `Help` /
/// `Warning` strings without a base control are surfaced as panel
/// copy by the View, not stored here. Settings GK proprietary
/// (Workspaces, Launchpad), telemetry-related (Analytics / BugReporting),
/// terminal-specific (`GitkrakenTerminal`, `WindowsShPathLocation`)
/// or owned by another cluster (`InitialCommitsToShowInGraph` →
/// graph #155) are deliberately absent.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralPreferences {
    #[serde(default = "default_true")]
    pub auto_fetch_enabled: bool,
    #[serde(default = "default_auto_fetch_interval_secs")]
    pub auto_fetch_interval_secs: u32,
    #[serde(default = "default_true")]
    pub auto_prune: bool,
    #[serde(default)]
    pub auto_update_submodules: bool,
    #[serde(default = "default_true")]
    pub conflict_detection_enabled: bool,
    #[serde(default = "default_branch_name")]
    pub default_branch_name: String,
    #[serde(default)]
    pub delete_orig_after_merge: bool,
    #[serde(default)]
    pub squash_on_merge: bool,
    #[serde(default = "default_true")]
    pub open_file_in_host: bool,
    #[serde(default = "default_true")]
    pub open_url_in_host: bool,
    #[serde(default = "default_true")]
    pub longpaths: bool,
    #[serde(default = "default_true")]
    pub git_config_default: bool,
    #[serde(default = "default_true")]
    pub remember_tabs: bool,
    #[serde(default)]
    pub use_extended_logging: bool,
    /// Suppresses the force-push-with-lease confirmation once the user
    /// ticks "Don't ask again" in it. Port of GK's app-level
    /// `forcePushSkipSecondWarning` (bundle:10786343), which is the only
    /// git-destructive confirmation GitKraken lets you skip — the lease
    /// is what makes that safe, since a moved remote blocks the push
    /// instead of overwriting it. Nothing that can actually lose work
    /// (force pull, discard, reset, ref deletion) is suppressible, here
    /// or there.
    #[serde(default)]
    pub force_push_skip_second_warning: bool,
}

impl Default for GeneralPreferences {
    fn default() -> Self {
        Self {
            auto_fetch_enabled: true,
            auto_fetch_interval_secs: default_auto_fetch_interval_secs(),
            auto_prune: true,
            auto_update_submodules: false,
            conflict_detection_enabled: true,
            default_branch_name: default_branch_name(),
            delete_orig_after_merge: false,
            squash_on_merge: false,
            open_file_in_host: true,
            open_url_in_host: true,
            longpaths: true,
            git_config_default: true,
            remember_tabs: true,
            use_extended_logging: false,
            force_push_skip_second_warning: false,
        }
    }
}

fn default_true() -> bool {
    true
}

/// Auto-fetch poll interval. 600 s (10 min) matches GK's
/// `GeneralPreferences-AutoFetchInterval` default. `u32` leaves
/// headroom for very long intervals; the panel will gate to a
/// sensible 30..3600 range without forcing a schema bump if the
/// upper bound moves.
fn default_auto_fetch_interval_secs() -> u32 {
    600
}

/// Default branch name. chajá deviates from GK (which still ships
/// `"master"`) and follows post-2020 Git's `init.defaultBranch`
/// convention. User-overridable from the panel.
fn default_branch_name() -> String {
    "main".to_string()
}
