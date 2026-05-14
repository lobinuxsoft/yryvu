// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type Accessor } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  getIntegrationToken,
  integrationPreflight,
  listConfiguredIntegrations,
  oauthAwait,
  oauthBegin,
  oauthCancel,
  removeIntegrationToken,
  saveIntegrationToken,
  type UserInfo,
} from "../../../../ipc";
import type { IntegrationType } from "./providerTable";
import { setIntegrationState } from "./state";

/**
 * Reactive cache for "is integration X configured?" queries. The
 * source of truth is the backend sidecar's `configured` flag; this
 * signal is hydrated on Preferences mount via `hydrateConfigured` and
 * kept in sync by the save / remove helpers below.
 *
 * Tokens themselves are never cached in JS heap — they go straight
 * from `saveIntegrationToken` IPC to the keyring without lingering
 * in this module. Callers that need the actual token value
 * (auth flows, future API clients) call `getIntegrationToken` from
 * the IPC module on-demand.
 */
const [configured, setConfigured] = createSignal<Set<IntegrationType>>(new Set());

/**
 * Reactive accessor for "is `type` configured in the backend?".
 * Drives the sub-tab sidebar's "connected" indicator dot.
 */
export function isIntegrationConfigured(type: IntegrationType): Accessor<boolean> {
  return () => configured().has(type);
}

/**
 * Pull the list of configured integrations from the backend into the
 * in-memory signal. Call once on Preferences mount; subsequent state
 * changes go through the save / remove helpers below.
 */
export async function hydrateConfigured(): Promise<void> {
  try {
    const list = await listConfiguredIntegrations();
    setConfigured(new Set<IntegrationType>(list as IntegrationType[]));
  } catch {
    // Soft-fail: empty set means no "connected" indicators light up.
    // The user can still configure integrations; backend errors will
    // surface from the save flow itself.
    setConfigured(new Set<IntegrationType>());
  }
}

/**
 * Save a token (and optional hostname for self-hosted) to the backend
 * AND validate it against the provider's API in one logical
 * operation:
 *
 *   1. Persist token to keyring + sidecar (`saveIntegrationToken`).
 *   2. Preflight: hit the provider's `/user` endpoint with the token,
 *      decode `UserInfo`.
 *   3. On success → update `configured` cache + push the live
 *      connected state with the real `UserInfo`.
 *   4. On preflight failure → **roll back the keyring write** (the
 *      user's intent was "connect", a persisted bad token is
 *      misleading) + rethrow.
 *
 * Providers without a per-provider client yet (everything except
 * GitHub / GitHub Enterprise as of #254) get `"not implemented"`
 * back from preflight — that's not a failure, we keep the persisted
 * token and let the existing mocked connect state stand.
 */
export async function saveToken(
  type: IntegrationType,
  token: string,
  hostname?: string,
): Promise<void> {
  await saveIntegrationToken(type, token, hostname);
  setConfigured((prev) => {
    const next = new Set(prev);
    next.add(type);
    return next;
  });
  try {
    const user = await integrationPreflight(type, token, hostname);
    setIntegrationState(type, { tag: "connected", user });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("not implemented")) {
      // Provider's API client hasn't landed yet — keep the persisted
      // token and let the existing mocked connect flow stand.
      return;
    }
    // Roll back the keyring write so the user can retry cleanly.
    try {
      await removeIntegrationToken(type);
    } catch {
      // Roll back failed — leave the orphan rather than mask the
      // original error. Next save will overwrite consistently.
    }
    setConfigured((prev) => {
      const next = new Set(prev);
      next.delete(type);
      return next;
    });
    throw err;
  }
}

/**
 * Hydrate a single integration's connected state on app start. Pulls
 * the persisted token from the keyring and runs preflight silently;
 * the dot indicator stays lit (sidecar says "configured") regardless,
 * but if the token has been revoked since last session the form opens
 * in the disconnected state with reason `token_revoked` so the user
 * can re-import.
 */
export async function hydrateConnectedState(type: IntegrationType): Promise<void> {
  let auth;
  try {
    auth = await getIntegrationToken(type);
  } catch {
    return;
  }
  if (!auth) return;
  try {
    const user: UserInfo = await integrationPreflight(
      type,
      auth.token,
      auth.hostname ?? undefined,
    );
    setIntegrationState(type, { tag: "connected", user });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("not implemented")) return;
    if (msg.includes("token rejected") || msg.includes("insufficient scopes")) {
      setIntegrationState(type, {
        tag: "disconnected",
        reason: "token_revoked",
      });
      return;
    }
    // Network errors / rate-limited: keep the cached state. The user
    // may still be able to do something useful with the cached token.
  }
}

/**
 * Remove a token from the backend. The hostname (sidecar) is preserved
 * — the `configured` flag is cleared but a future re-connect doesn't
 * lose the user's URL config.
 */
export async function removeToken(type: IntegrationType): Promise<void> {
  await removeIntegrationToken(type);
  setConfigured((prev) => {
    const next = new Set(prev);
    next.delete(type);
    return next;
  });
}

/**
 * Drive the full OAuth Authorization Code + PKCE flow end-to-end:
 *
 *   1. `oauth_begin` parks a session in the backend registry, returns
 *      `{ sessionId, authorizeUrl }`.
 *   2. Open `authorizeUrl` in the user's browser via
 *      `tauri-plugin-opener` — the user grants consent there.
 *   3. `oauth_await(sessionId)` blocks until the provider redirects to
 *      our loopback (5-min window, see backend `DEFAULT_FLOW_TIMEOUT`).
 *   4. The returned access token is piped through `saveToken` (which
 *      preflights + persists to keyring) so OAuth-acquired tokens go
 *      through exactly the same validation as PAT-entered ones.
 *
 * Returns the `sessionId` so the caller can call `cancelOAuthFlow`
 * if the user dismisses the dialog before completion.
 */
export async function startOAuthFlow(
  type: IntegrationType,
  hostname?: string,
): Promise<string> {
  const begin = await oauthBegin(type);
  await openUrl(begin.authorizeUrl);
  const token = await oauthAwait(begin.sessionId);
  await saveToken(type, token, hostname);
  return begin.sessionId;
}

/**
 * Drop the parked OAuth session before the browser round-trip
 * completes. Used when the user dismisses the connect dialog. The
 * bound loopback port is released; a fresh `startOAuthFlow` will bind
 * a new one.
 */
export function cancelOAuthFlow(sessionId: string): Promise<void> {
  return oauthCancel(sessionId);
}

/**
 * Build the deep-link URL for the provider's "create token" page.
 * For absolute paths (`.com` providers, `tokenGenPath` starts with
 * `https://`), returns the path unchanged plus any params. For
 * relative paths (self-hosted), concatenates against the user-supplied
 * hostname URL.
 *
 * Returns `null` when the provider has no `tokenGenPath` (Trello) OR
 * when a self-hosted provider has no hostname configured yet.
 */
export function buildTokenGenUrl(
  tokenGenPath: string | null,
  tokenGenParams: string | null,
  hostnameUrl: string,
): string | null {
  if (!tokenGenPath) return null;
  let base: string;
  if (tokenGenPath.startsWith("https://") || tokenGenPath.startsWith("http://")) {
    base = tokenGenPath;
  } else {
    if (!hostnameUrl) return null;
    // Strip trailing slash from hostnameUrl to avoid double slashes.
    const trimmedHost = hostnameUrl.endsWith("/")
      ? hostnameUrl.slice(0, -1)
      : hostnameUrl;
    base = `${trimmedHost}${tokenGenPath}`;
  }
  return tokenGenParams ? `${base}?${tokenGenParams}` : base;
}
