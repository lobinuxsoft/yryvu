// SPDX-License-Identifier: AGPL-3.0-or-later

//! Submodule preferences (issue #98, preferences slice).
//!
//! Holds the GLOBAL "Keep submodules up to date" default — GK keeps
//! this on the profile and surfaces a per-repo tri-state override
//! (Use global / Enabled for this repo / Disabled for this repo) in
//! the Submodules preferences tab. The per-repo override lives in the
//! repo's own `.git/config` under `[yryvu] submoduleAutoUpdate`
//! (issue-tracker pattern), NOT here.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmodulesPreferences {
    /// Global default for "Keep submodules up to date" — auto-run
    /// `git submodule update --init --recursive` after checkout /
    /// merge / pull. GK ships this enabled; so do we.
    #[serde(default = "default_auto_update")]
    pub auto_update_default: bool,
}

impl Default for SubmodulesPreferences {
    fn default() -> Self {
        Self {
            auto_update_default: default_auto_update(),
        }
    }
}

fn default_auto_update() -> bool {
    true
}
