// SPDX-License-Identifier: AGPL-3.0-or-later

//! GPG signing preferences (issue #104, subset).
//!
//! Stores the signing-key identifier + per-target sign-by-default
//! toggles. The original issue body also called for key-list
//! enumeration (`gpg --list-secret-keys`), passphrase caching, and a
//! test-sign button — those require shelling out to the `gpg` binary
//! and a per-profile model (blocked by #22), so they stay out of scope
//! here. This struct is persistence only; the commit / tag pipelines
//! consume it in follow-up sub-PRs.
//!
//! `signing_key_id` is a free-form string — typically an 8/16/40-char
//! fingerprint or a `[email protected]` address Git resolves via its
//! own `user.signingkey` rules. `None` means "use Git's own
//! resolution" (e.g. `git config user.signingkey`).

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GpgPreferences {
    #[serde(default)]
    pub signing_key_id: Option<String>,
    #[serde(default)]
    pub sign_commits_by_default: bool,
    #[serde(default)]
    pub sign_tags_by_default: bool,
    #[serde(default)]
    pub ssh_signing_enabled: bool,
}
