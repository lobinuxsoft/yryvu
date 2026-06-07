// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Result of `oauth_begin` — the URL to open in the user's browser plus
 * an opaque session id that `oauth_await` / `oauth_cancel` need.
 */
export interface OAuthBeginResult {
  sessionId: string;
  authorizeUrl: string;
}

/**
 * Phase 1 of the OAuth flow. The backend binds an ephemeral loopback
 * port, generates PKCE + CSRF state, builds the provider's authorize
 * URL, and parks the session under `sessionId` for `oauth_await` to
 * pick up. The caller is expected to open `authorizeUrl` via
 * `tauri-plugin-opener` and persist `sessionId` until
 * `oauth_await` returns.
 *
 * Errors:
 * - `"OAuth not configured"` — provider's `client_id` is empty (no
 *   `.env.local` / Repo Secret bake). Frontend should disable the
 *   OAuth button when `provider.isConfigured()` is false to avoid
 *   surfacing this.
 */
export function oauthBegin(integrationType: string): Promise<OAuthBeginResult> {
  return invoke<OAuthBeginResult>("oauth_begin", { integrationType });
}

/**
 * Phase 2 of the OAuth flow. Blocks until the provider redirects to
 * the loopback (default 5-minute window in the backend), then exchanges
 * the authorization code for an access token. Returns the raw token —
 * the caller pipes it through `saveToken` (preflight + persist).
 *
 * Errors:
 * - `"OAuth flow cancelled by user"` — user denied consent in the browser.
 * - `"OAuth state mismatch"` — CSRF defense triggered.
 * - `"OAuth flow timed out"` — no redirect arrived in 5 min.
 * - `"OAuth code-for-token exchange failed: <detail>"` — provider rejected the code.
 * - `"OAuth session not found"` — `sessionId` was never `oauth_begin`'d
 *   or has been consumed by a previous await.
 */
export function oauthAwait(sessionId: string): Promise<string> {
  return invoke<string>("oauth_await", { sessionId });
}

/**
 * Drop a parked OAuth session by `sessionId` without consuming it.
 * Releases the bound loopback port. Always succeeds — calling cancel
 * for an unknown id is a no-op.
 */
export function oauthCancel(sessionId: string): Promise<void> {
  return invoke<void>("oauth_cancel", { sessionId });
}
