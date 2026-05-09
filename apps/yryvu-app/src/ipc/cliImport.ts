// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Read the GitHub access token from the user's existing `gh` CLI session.
 * Shells out to `gh auth token` server-side. Optional `hostname` arg
 * is forwarded as `gh --hostname <h>` for GitHub Enterprise sessions
 * (chajá strips scheme + path before passing).
 *
 * Errors surface as the typed `BackendError` strings:
 * - `"'gh' CLI not found on PATH"` — gh not installed.
 * - `"'gh' CLI is not authenticated"` — needs `gh auth login`.
 * - `"'gh' CLI failed: <stderr>"` — generic shell-out failure.
 *
 * The frontend matches on substrings to render the right toast CTA.
 */
export function importGhToken(hostname?: string): Promise<string> {
  return invoke<string>("import_gh_token", {
    hostname: hostname ?? null,
  });
}
