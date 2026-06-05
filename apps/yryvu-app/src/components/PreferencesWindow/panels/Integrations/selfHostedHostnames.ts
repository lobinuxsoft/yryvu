// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type Accessor } from "solid-js";
import { getIntegrationHostname, setIntegrationHostname } from "../../../../ipc";
import type { IntegrationType } from "./providerTable";
import { selectedCredentialProfileId } from "./selectedProfile";

/**
 * Per-integration custom hostname storage. Backed by the Rust sidecar
 * (`integrations.json` in the app's local data dir) — the in-memory
 * signal map is a reactive cache that survives via the backend.
 *
 * Hidration happens on demand: the first call to `hydrateHostname`
 * fetches from the backend and populates the signal. Subsequent reads
 * return the cached value reactively.
 *
 * `setSelfHostedHostname` writes through to the backend AND updates
 * the cache so callers see the change immediately. If the backend
 * write fails, the function rejects — callers should toast the error.
 */
const SIGNALS = new Map<
  IntegrationType,
  ReturnType<typeof createSignal<string>>
>();
const HYDRATED = new Set<IntegrationType>();

function getSignal(type: IntegrationType) {
  let entry = SIGNALS.get(type);
  if (!entry) {
    entry = createSignal<string>("");
    SIGNALS.set(type, entry);
  }
  return entry;
}

export function selfHostedHostname(type: IntegrationType): Accessor<string> {
  return getSignal(type)[0];
}

/**
 * Pull the hostname from the backend sidecar into the in-memory
 * signal. Idempotent — only fetches the first time per
 * `integrationType`. Subsequent calls are no-ops (the signal is
 * already populated and reactive).
 *
 * Returns the hydrated value (or empty string when the backend has
 * nothing stored).
 */
export async function hydrateHostname(type: IntegrationType): Promise<string> {
  if (HYDRATED.has(type)) {
    return getSignal(type)[0]();
  }
  try {
    const value =
      (await getIntegrationHostname(selectedCredentialProfileId(), type)) ?? "";
    getSignal(type)[1](value);
    HYDRATED.add(type);
    return value;
  } catch {
    // Soft-fail: keep the empty signal, mark hydrated so we don't
    // hammer the backend on every re-render. The caller may surface
    // the error elsewhere.
    HYDRATED.add(type);
    return "";
  }
}

export async function setSelfHostedHostname(
  type: IntegrationType,
  url: string,
): Promise<void> {
  await setIntegrationHostname(selectedCredentialProfileId(), type, url);
  getSignal(type)[1](url);
  HYDRATED.add(type);
}

/**
 * Drop every hydrated hostname so the next `hydrateHostname` re-fetches
 * for the now-active profile. Called when the panel's profile selector
 * changes — hostnames are profile-scoped, so the cache must not bleed
 * across profiles.
 */
export function resetHostnameHydration(): void {
  HYDRATED.clear();
  for (const [, signal] of SIGNALS) {
    signal[1]("");
  }
}

/**
 * Validate a user-supplied hostname URL. Trims, auto-prepends
 * `https://` for bare hostnames, then accepts only well-formed http/https
 * URLs without paths or query strings.
 *
 * Returns the normalised URL on success, or an error message on
 * failure. **chajá deviation**: GK's bundle uses `http://gitkraken.example.com`
 * as placeholder verbatim. We default to `https://` for bare hostnames
 * since modern self-hosted setups use TLS by default.
 */
export function normalizeHostnameUrl(input: string): {
  ok: true;
  url: string;
} | { ok: false; error: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "URL is required" };
  }
  // Bare hostname → auto-prepend https://
  const withScheme =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must use http:// or https://" };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "URL must include a hostname" };
  }
  // Strip trailing slash + drop path/search/hash; canonical form is origin only.
  return { ok: true, url: parsed.origin };
}
