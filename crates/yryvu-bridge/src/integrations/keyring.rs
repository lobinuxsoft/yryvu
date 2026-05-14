// SPDX-License-Identifier: AGPL-3.0-or-later

//! Keyring wrapper. Backed by the [`keyring`] crate, which abstracts
//! over libsecret (Linux), Keychain (macOS), and Credential Vault
//! (Windows). Failures map to typed [`BackendError`] variants:
//!
//! - Service unavailable (libsecret not running, headless distro) →
//!   [`BackendError::KeyringUnavailable`]. UI surfaces as "OS keyring
//!   service unavailable" with a retry CTA after the user starts the
//!   service.
//! - Entry not found → returns `Ok(None)` (not an error condition; the
//!   caller decides what to do).
//! - Anything else → [`BackendError::KeyringFailed`] with detail.

use crate::backend::BackendError;

/// Service identifier under which all yryvu tokens live. Keep this
/// stable — changing it would orphan every existing token in the
/// keyring.
const KEYRING_SERVICE: &str = "io.yryvu.integrations";

fn entry(integration_type: &str) -> Result<keyring::Entry, BackendError> {
    keyring::Entry::new(KEYRING_SERVICE, integration_type).map_err(map_err)
}

fn map_err(e: keyring::Error) -> BackendError {
    use keyring::Error as KE;
    match e {
        KE::PlatformFailure(inner) | KE::NoStorageAccess(inner) => {
            // libsecret not running, dbus session missing, etc — the
            // keyring service itself is the problem, not yryvu.
            let detail = format!("{inner}");
            if detail.to_lowercase().contains("not provided")
                || detail.to_lowercase().contains("no such service")
                || detail.to_lowercase().contains("connection refused")
            {
                BackendError::KeyringUnavailable
            } else {
                BackendError::KeyringFailed { detail }
            }
        }
        other => BackendError::KeyringFailed {
            detail: other.to_string(),
        },
    }
}

/// Persist `token` in the OS keyring for `integration_type`.
pub fn save_token(integration_type: &str, token: &str) -> Result<(), BackendError> {
    entry(integration_type)?
        .set_password(token)
        .map_err(map_err)
}

/// Fetch the token for `integration_type`, or `Ok(None)` if no entry
/// exists. "Not found" is not an error — it's the expected state for
/// an unconfigured integration.
pub fn get_token(integration_type: &str) -> Result<Option<String>, BackendError> {
    match entry(integration_type)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(map_err(e)),
    }
}

/// Remove the keyring entry for `integration_type`. "Not found" is
/// treated as success — the desired end-state (no entry) is already
/// achieved.
pub fn remove_token(integration_type: &str) -> Result<(), BackendError> {
    match entry(integration_type)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(map_err(e)),
    }
}
