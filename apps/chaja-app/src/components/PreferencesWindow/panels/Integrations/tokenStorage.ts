// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type Accessor } from "solid-js";
import {
  listConfiguredIntegrations,
  removeIntegrationToken,
  saveIntegrationToken,
} from "../../../../ipc";
import type { IntegrationType } from "./providerTable";

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
 * Save a token (and optional hostname for self-hosted) to the backend.
 * Updates the local "configured" cache on success so the UI reflects
 * immediately. On failure, the cache is unchanged and the promise
 * rejects — callers should toast the backend error.
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
