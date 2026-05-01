// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type Accessor } from "solid-js";
import type { IntegrationType } from "./providerTable";

/**
 * Per-integration PAT (Personal Access Token) storage. Mirror of
 * GK's `getCredentialsByIntegrationType` (`bundle:203622`) — the
 * map of `integrationType → token` for users who chose the PAT
 * fallback path.
 *
 * Signal-only this PR; persistence lands with the backend cluster
 * via the keyring crate (audit doc 06). Tokens never persist to disk
 * in plaintext — when the backend lands, swap this in-memory signal
 * for a `keyring`-backed store.
 *
 * **Security note (current state)**: tokens live in memory only.
 * Reloading chajá clears them. Do NOT lift this signal to disk
 * persistence until the keyring wrapper exists.
 */
const SIGNALS = new Map<
  IntegrationType,
  ReturnType<typeof createSignal<string>>
>();

function getSignal(type: IntegrationType) {
  let entry = SIGNALS.get(type);
  if (!entry) {
    entry = createSignal<string>("");
    SIGNALS.set(type, entry);
  }
  return entry;
}

export function integrationToken(type: IntegrationType): Accessor<string> {
  return getSignal(type)[0];
}

export function setIntegrationToken(type: IntegrationType, token: string): void {
  getSignal(type)[1](token);
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
