// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Compute the visible-ref allowlist for `Smart Branch Visibility`.
 *
 * Returns full ref names (e.g. `refs/heads/main`, `refs/remotes/origin/main`).
 * An empty array means the caller should **not** apply the filter — typical
 * causes are detached HEAD, an unborn HEAD, or a repo-open failure. chajá
 * surfaces this empty case explicitly so the UI can distinguish "do not
 * apply" from "everything is hidden".
 *
 * `profileDefault` mirrors GitKraken's `init.defaultBranch` profile setting;
 * pass `undefined` when chajá has no profile-level override (the current
 * default — chajá has no per-profile config yet).
 *
 * See `docs/research/gitkraken-graph/25-smart-branch-visibility.md`.
 */
export function smartVisibleRefs(
  repoPath: string,
  profileDefault?: string,
): Promise<string[]> {
  return invoke<string[]>("smart_visible_refs", {
    repoPath,
    profileDefault: profileDefault ?? null,
  });
}
