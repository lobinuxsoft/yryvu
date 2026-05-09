// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};

/// Sidecar JSON schema version. Bump only when there's a load-time
/// migration; adding optional fields with `#[serde(default)]` does not
/// require a bump (matches chajá's existing schema-versioning pattern).
pub const SIDECAR_VERSION: u32 = 1;

/// Combined credentials returned from `get_integration_token`. The
/// frontend gets both the secret token (from keyring) and the
/// configured hostname (from sidecar) in a single round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthData {
    pub token: String,
    /// User-supplied URL for self-hosted variants (`null` for `.com`
    /// providers). Stored separately from the token because it isn't
    /// secret and the user may want to edit it before/after the token
    /// is configured.
    pub hostname: Option<String>,
}

/// Per-integration sidecar entry. Lives in the unencrypted
/// `integrations.json` config file because hostnames aren't secret —
/// only the token (in the OS keyring) is.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationEntry {
    /// Whether a token is currently stored in the keyring for this
    /// integration. Tracking it here avoids a keyring round-trip every
    /// time the UI wants to render the "connected" indicator.
    #[serde(default)]
    pub configured: bool,
    /// User-supplied URL for self-hosted variants. `None` for `.com`
    /// providers and for self-hosted variants the user hasn't
    /// configured yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
}
