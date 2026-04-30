// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Module-level cache for the Repo Management list. Lives outside the
 * RepoManagementBody component so the createResource fetch survives
 * tab-switch unmount/remount cycles — without this, the IPC call
 * (list_known_repos walks every recent repo with gix open + status
 * scan) re-runs every time the user comes back to the tab. On a list
 * of 10 repos that's ~500-2000 ms of perceived lag.
 *
 * Two lifecycle moments mutate the cache:
 *   - First call to ensureInitialized() (lazy seed from localStorage).
 *   - refreshKnownRepos() — explicit user action (header refresh
 *     button) or an external "I just opened a repo, please update".
 *
 * The createResource is shared across all consumers, so multiple
 * RepoManagementBody mounts (theoretical — the tab is a singleton) all
 * read the same data without duplicating work.
 */

import { createResource, createSignal } from "solid-js";

import { listKnownRepos, type KnownRepoInfo } from "../../ipc";
import { loadRecentRepos } from "../../state";

const [pathsInternal, setPathsInternal] = createSignal<string[]>([]);
let initialized = false;

export const [repos, { refetch }] = createResource(
  pathsInternal,
  async (ps): Promise<KnownRepoInfo[]> => {
    if (ps.length === 0) return [];
    return listKnownRepos(ps);
  },
);

/// Lazy seed from localStorage. Idempotent — calling more than once is
/// a no-op after the first invocation. The component calls this from
/// its top-level body so the resource starts loading the first time
/// the Repo Management tab gets selected.
export function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  setPathsInternal(loadRecentRepos().map((r) => r.path));
}

/// Refresh the list. Re-reads localStorage (a repo may have been added
/// since last load) and re-fires the backend call so dirty status +
/// branch updates show up after work in another tab.
export function refreshKnownRepos(): void {
  setPathsInternal(loadRecentRepos().map((r) => r.path));
  // If the path list didn't change, the resource won't re-fire because
  // its source signal didn't update. Force-refetch covers the "same
  // repos but their branch/dirty changed" case.
  void refetch();
}
