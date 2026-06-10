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
  profileId: string | null,
  integrationType: string,
  token: string,
  hostname?: string,
): Promise<void> {
  return invoke<void>("save_integration_token", {
    profileId,
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
  profileId: string | null,
  integrationType: string,
): Promise<AuthData | null> {
  return invoke<AuthData | null>("get_integration_token", {
    profileId,
    integrationType,
  });
}

/**
 * Wipe credentials for `integrationType`. Removes the keyring entry
 * AND clears the sidecar's `configured` flag. The hostname (if any)
 * is preserved so a subsequent re-connect doesn't lose the user's
 * URL config.
 */
export function removeIntegrationToken(
  profileId: string | null,
  integrationType: string,
): Promise<void> {
  return invoke<void>("remove_integration_token", {
    profileId,
    integrationType,
  });
}

/**
 * Enumerate integration types whose sidecar entry has `configured: true`.
 * Cheap (no keyring round-trip) — drives the sub-tab sidebar's
 * "connected" indicator dot via a single call on Preferences mount.
 */
export function listConfiguredIntegrations(
  profileId: string | null,
): Promise<string[]> {
  return invoke<string[]>("list_configured_integrations", { profileId });
}

/**
 * Set just the hostname for a self-hosted integration. The user can
 * configure the URL before pasting / importing the token.
 */
export function setIntegrationHostname(
  profileId: string | null,
  integrationType: string,
  hostname: string,
): Promise<void> {
  return invoke<void>("set_integration_hostname", {
    profileId,
    integrationType,
    hostname,
  });
}

/**
 * Read just the hostname for a self-hosted integration. Returns `null`
 * when no hostname is configured.
 */
export function getIntegrationHostname(
  profileId: string | null,
  integrationType: string,
): Promise<string | null> {
  return invoke<string | null>("get_integration_hostname", {
    profileId,
    integrationType,
  });
}

/**
 * User info returned by `integration_preflight`. Mirrors the Rust
 * `UserInfo` struct (camelCase serialization). Shared base identity
 * shape reused by PR / issue / comment payloads.
 */
export interface UserInfo {
  login: string;
  displayName: string;
  avatarUrl: string;
}

/**
 * Validate `token` against the provider's API and fetch the
 * authenticated user's profile. The frontend calls this:
 * - right after `saveIntegrationToken` so the user sees real avatar +
 *   name immediately on save (and bad tokens fail loudly).
 * - on app start to hydrate the connected state for every persisted
 *   integration.
 *
 * Errors propagate as backend strings; the caller matches on
 * substrings to render the right toast CTA:
 * - `"token rejected by provider"` → re-enter or regenerate token
 * - `"insufficient scopes"` → grant the missing scopes
 * - `"rate-limited"` → wait until the reset timestamp
 * - `"network error"` → check connectivity
 * - `"not implemented"` → silently skip (provider's per-PR client
 *   hasn't landed yet)
 */
export function integrationPreflight(
  integrationType: string,
  token: string,
  hostname?: string,
): Promise<UserInfo> {
  return invoke<UserInfo>("integration_preflight", {
    integrationType,
    token,
    hostname: hostname ?? null,
  });
}
