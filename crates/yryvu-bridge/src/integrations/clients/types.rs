// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};

/// User-info shape returned by every provider's preflight call.
/// camelCase serialization so the frontend store can drop it
/// straight into the `connected` state branch without remapping.
///
/// Mirror of GK's `getUserByIntegrationType` shape (`bundle:203626`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    /// Stable login / handle (e.g. `lobinuxsoft`).
    pub login: String,
    /// Display name (e.g. `Matias Galarza`). Some providers return
    /// null for users who never set a display name; falls back to
    /// `login` in that case.
    pub display_name: String,
    /// HTTPS URL of the user's avatar (e.g.
    /// `https://avatars.githubusercontent.com/u/12345?v=4`). Always
    /// HTTPS; the frontend uses it as `<img src>` directly.
    pub avatar_url: String,
}

/// Provider-agnostic label shape — GitHub / GitLab / Gitea all model
/// labels as `{ name, color }`. Color is a 6-digit hex string WITHOUT
/// the leading `#` (matching GitHub's REST API); the frontend prepends
/// `#` when applying as a `background-color` CSS value.
///
/// GitLab returns color with a leading `#`; that provider's adapter
/// strips it before producing this shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub name: String,
    pub color: String,
}
