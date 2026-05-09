// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Module-level cache for the Repo Management list. Lives outside the
 * RepoManagementBody component so the IPC fetch survives tab-switch
 * unmount/remount cycles. Two layers of caching:
 *
 *   1. **In-memory signal** — survives mount/remount within a session.
 *   2. **localStorage snapshot** — survives app restart. Stale-while-
 *      revalidate: render the persisted snapshot immediately so the
 *      tab body shows data on first paint, then refresh in background
 *      and replace.
 *
 * The "stale" rendering is fine — the data is up-to-date as of the
 * last session close; the in-flight refresh updates it within ~100-
 * 500 ms after the tab opens. Compared to "wait for fetch then show",
 * the perceived load time drops to zero.
 *
 * Storage key namespaced under STORAGE_PREFIX to match the rest of
 * the app's localStorage scheme.
 */

import { createSignal } from "solid-js";

import { listKnownRepos, type KnownRepoInfo } from "../../ipc";
import { loadRecentRepos } from "../../state";

const SNAPSHOT_KEY = "chaja.knownReposSnapshot";

function loadSnapshot(): KnownRepoInfo[] {
  const raw = localStorage.getItem(SNAPSHOT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as KnownRepoInfo[];
  } catch {
    return [];
  }
}

function saveSnapshot(snapshot: KnownRepoInfo[]): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage quota exceeded or disabled — ignore. Worst case
    // the next session loses the stale-render benefit.
  }
}

const [repos, setRepos] = createSignal<KnownRepoInfo[]>(loadSnapshot());
const [loading, setLoading] = createSignal(false);
let initialized = false;
let inFlight: Promise<void> | undefined;

export { repos, loading };

/// Lazy seed. First call kicks off a background revalidation against
/// the live recent-repos list. Subsequent calls within the same
/// session are no-ops (the in-flight + cache cover them).
export function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  void refreshKnownRepos();
}

/// Drop a path from the in-memory + persisted snapshot, no re-fetch.
/// Used by the per-row × and bulk Remove flows — the call site has
/// already mutated localStorage via removeRecentRepo, so we just
/// mirror the deletion in the rendered list. Skipping the IPC keeps
/// the UI instant; the rest of the rows are already correct in the
/// cache and don't need a fresh scan.
export function removeFromCache(paths: string[]): void {
  if (paths.length === 0) return;
  const drop = new Set(paths);
  const next = repos().filter((r) => !drop.has(r.path));
  setRepos(next);
  saveSnapshot(next);
}

/// Force a re-scan. Re-reads recent-repo paths from localStorage (a
/// repo may have been added) and dispatches the backend call. Returns
/// the in-flight promise — concurrent calls deduplicate so a UI burst
/// (open repo + refresh button click + …) only fires once.
export function refreshKnownRepos(): Promise<void> {
  if (inFlight) return inFlight;
  setLoading(true);
  const paths = loadRecentRepos().map((r) => r.path);
  inFlight = (async () => {
    try {
      const fresh = paths.length === 0 ? [] : await listKnownRepos(paths);
      setRepos(fresh);
      saveSnapshot(fresh);
    } catch {
      // Backend errored — keep the stale snapshot so the user still
      // sees something. Per-row errors come back inside KnownRepoInfo
      // so a wholesale catch only fires on IPC-level failures (e.g.
      // Tauri runtime not ready), which the component-level fallback
      // can't differentiate from "no data" anyway.
    } finally {
      setLoading(false);
      inFlight = undefined;
    }
  })();
  return inFlight;
}
