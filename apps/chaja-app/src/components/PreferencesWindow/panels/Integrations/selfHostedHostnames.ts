// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type Accessor } from "solid-js";
import type { IntegrationType } from "./providerTable";

/**
 * Per-integration custom hostname storage. Mirror of GK's
 * `getHostnamesByIntegrationType` selector (`bundle:203670`) — the
 * map of `integrationType → user-supplied URL` for self-hosted
 * providers (GHE, GitLab self-managed, Bitbucket Data Center, Jira
 * Data Center).
 *
 * Signal-only this PR; persistence lands with the backend foundation
 * cluster. Once the Rust crate exists, swap the signal for a
 * `createResource` keyed off the persisted config.
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

export function selfHostedHostname(type: IntegrationType): Accessor<string> {
  return getSignal(type)[0];
}

export function setSelfHostedHostname(type: IntegrationType, url: string): void {
  getSignal(type)[1](url);
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
