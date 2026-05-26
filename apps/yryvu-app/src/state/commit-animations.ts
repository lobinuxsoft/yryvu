// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Transient SHA flags driving GitKraken's commit-node animations
 * (issue #53):
 *
 * - `recentlyCreatedSha` — pulses the new commit's node on
 *   `scale(1.0 → 1.25 → 1.0)` over 400ms. Fired right after
 *   `commit_staged` / `create_commit` / `commit_and_push` returns.
 *   Merge commits and the WIP row do **not** animate per GK spec.
 * - `highlightedSha` — opacity flash on lane color over 600ms when the
 *   user navigates to a specific commit (Cmd+P "Go to commit",
 *   selection from sidebar, etc).
 *
 * Both auto-expire so the keyframe doesn't replay on subsequent
 * re-renders.
 */

import { createSignal } from "solid-js";

const COMMIT_CREATED_MS = 400;
const COMMIT_HIGHLIGHT_MS = 600;

const [recentlyCreatedSha, setRecentlyCreatedSha] = createSignal<string | undefined>(
  undefined,
);
const [highlightedSha, setHighlightedSha] = createSignal<string | undefined>(undefined);

export { recentlyCreatedSha, highlightedSha };

/// Mark `sha` as freshly authored — node pulses scale 1.0→1.25→1.0.
/// Auto-clears so the same sha can fire again on a later commit.
export function flashCommitCreated(sha: string): void {
  setRecentlyCreatedSha(sha);
  setTimeout(() => {
    // Only clear if it's still us — racing two flashes shouldn't cut
    // the second one short.
    if (recentlyCreatedSha() === sha) setRecentlyCreatedSha(undefined);
  }, COMMIT_CREATED_MS + 50);
}

/// Mark `sha` as the navigation target — lane color flashes
/// 1.0→0.3→1.0 opacity over 600ms.
export function flashCommitHighlight(sha: string): void {
  setHighlightedSha(sha);
  setTimeout(() => {
    if (highlightedSha() === sha) setHighlightedSha(undefined);
  }, COMMIT_HIGHLIGHT_MS + 50);
}
