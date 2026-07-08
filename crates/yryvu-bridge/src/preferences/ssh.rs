// SPDX-License-Identifier: AGPL-3.0-or-later

//! SSH key preferences (issue #47).
//!
//! Records where the in-app SSH key generation flow wrote each private
//! key, keyed by the host it was generated for (`github.com`,
//! `gitlab.example.org`, …) so the wizard can show "you already have a
//! yryvu key for this host" across sessions. Persistence only — the
//! actual authentication happens through the user's ssh-agent /
//! `~/.ssh/config`, never by yryvu reading these files back.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshPreferences {
    /// Host → absolute private key path written by the generation
    /// wizard. BTreeMap keeps the serialized form stable across saves.
    #[serde(default)]
    pub key_paths: BTreeMap<String, String>,
}
