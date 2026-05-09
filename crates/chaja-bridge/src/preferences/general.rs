// SPDX-License-Identifier: AGPL-3.0-or-later

//! General preferences (issue #102) — port of GitKraken's
//! `GeneralPreferences` tab. Empty in this commit; fourteen fields
//! land in the follow-up commit of the same PR after the module split.

use serde::{Deserialize, Serialize};

/// `Preferences > General` panel state (issue #102). Empty until the
/// follow-up commit ports the validated fourteen fields from
/// `app/src/strings/en-us.json`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralPreferences {}
