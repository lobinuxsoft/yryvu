// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Combined credentials for an integration. The token always comes
 * from the OS keyring; the hostname comes from the JSON sidecar
 * (only set for self-hosted variants). Returned together so callers
 * get both in a single round-trip.
 */
export interface AuthData {
  token: string;
  hostname: string | null;
}

/**
 * Persist credentials for `integrationType`. The Rust backend writes
 * the token to the OS keyring (libsecret / Keychain / Credential Vault)
 * and the metadata (hostname + `configured: true`) to the
 * `integrations.json` sidecar.
 *
 * Errors propagate as backend strings; the caller maps known
 * substrings to user-facing toasts:
 * - `"OS keyring service unavailable"` → render keyring CTA
 * - `"keyring failed: <detail>"` → render generic error
 * - `"sidecar schema version"` → render schema-mismatch error
 */
export function saveIntegrationToken(
  integrationType: string,
  token: string,
  hostname?: string,
): Promise<void> {
  return invoke<void>("save_integration_token", {
    integrationType,
    token,
    hostname: hostname ?? null,
  });
}

/**
 * Fetch credentials for `integrationType`. Returns `null` when no
 * token is stored — that's not an error condition, it's the expected
 * state for an unconfigured integration.
 */
export function getIntegrationToken(
  integrationType: string,
): Promise<AuthData | null> {
  return invoke<AuthData | null>("get_integration_token", { integrationType });
}

/**
 * Wipe credentials for `integrationType`. Removes the keyring entry
 * AND clears the sidecar's `configured` flag. The hostname (if any)
 * is preserved so a subsequent re-connect doesn't lose the user's
 * URL config.
 */
export function removeIntegrationToken(integrationType: string): Promise<void> {
  return invoke<void>("remove_integration_token", { integrationType });
}

/**
 * Enumerate integration types whose sidecar entry has `configured: true`.
 * Cheap (no keyring round-trip) — drives the sub-tab sidebar's
 * "connected" indicator dot via a single call on Preferences mount.
 */
export function listConfiguredIntegrations(): Promise<string[]> {
  return invoke<string[]>("list_configured_integrations", {});
}

/**
 * Set just the hostname for a self-hosted integration. The user can
 * configure the URL before pasting / importing the token.
 */
export function setIntegrationHostname(
  integrationType: string,
  hostname: string,
): Promise<void> {
  return invoke<void>("set_integration_hostname", { integrationType, hostname });
}

/**
 * Read just the hostname for a self-hosted integration. Returns `null`
 * when no hostname is configured.
 */
export function getIntegrationHostname(
  integrationType: string,
): Promise<string | null> {
  return invoke<string | null>("get_integration_hostname", { integrationType });
}
