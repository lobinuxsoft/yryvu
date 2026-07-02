// SPDX-License-Identifier: AGPL-3.0-or-later

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  appActiveWithin,
  markAppActivity,
  setBranchesNonce,
  setGraphNonce,
  setWorkingTreeNonce,
} from "./refresh";

/// Granular events emitted by the backend repo watcher. Must match the
/// constants in `crates/yryvu-bridge/src/repo/watcher.rs`.
const REFS_CHANGED_EVENT = "repo-refs-changed";
const INDEX_CHANGED_EVENT = "repo-index-changed";
const WORKTREE_CHANGED_EVENT = "repo-worktree-changed";

/// Collect the burst of events a single change produces (a commit touches
/// refs + index + worktree almost at once) into one refresh, and let the
/// suppression check run once per burst rather than per event.
const COALESCE_MS = 120;

/// How long after an app-initiated repo touch we treat incoming watcher
/// events as the echo of our own reads/writes rather than a real external
/// change. Must comfortably exceed a refetch's read duration plus the
/// backend debounce (400 ms), so the atime churn a `git status` / graph walk
/// stirs up on NTFS/fuseblk drains inside the window instead of looping.
/// The cost is that a genuine external change within this window of app
/// activity waits for the next event (or a manual refresh) — acceptable for
/// a live-refresh convenience.
const SUPPRESS_MS = 2500;

let unlisteners: UnlistenFn[] = [];
let pendingRefs = false;
let pendingWorktree = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/// Bump nonces *directly* (not via `refreshGraph` / `refreshWorkingTree`) so
/// the flush controls exactly when `markAppActivity` stamps — once, after all
/// pending slices are applied.
function applyPending() {
  const refs = pendingRefs;
  const worktree = pendingWorktree;
  pendingRefs = false;
  pendingWorktree = false;

  // Echo of our own reads/writes churning the tree — skip.
  if (appActiveWithin(SUPPRESS_MS)) return;

  if (refs) {
    setGraphNonce((n) => n + 1);
    setBranchesNonce((n) => n + 1);
  }
  if (worktree) {
    setWorkingTreeNonce((n) => n + 1);
  }
  // Arm the window: the refetches we just triggered will read the repo and
  // stir their own watcher echo, which the next flush must suppress.
  markAppActivity();
}

function scheduleFlush() {
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    applyPending();
  }, COALESCE_MS);
}

/// Subscribe to the backend repo-watcher events so the UI live-refreshes on
/// external edits, terminal `git`, and builds. Idempotent — a second call is
/// a no-op until [`unmountRepoLiveRefresh`] runs. The watcher itself is
/// started per-repo from `state/repo.ts`; this only wires the listeners.
export async function mountRepoLiveRefresh(): Promise<void> {
  if (unlisteners.length) return;

  const onRefs = () => {
    pendingRefs = true;
    scheduleFlush();
  };
  const onWorktree = () => {
    pendingWorktree = true;
    scheduleFlush();
  };

  unlisteners = await Promise.all([
    listen(REFS_CHANGED_EVENT, onRefs),
    listen(INDEX_CHANGED_EVENT, onWorktree),
    listen(WORKTREE_CHANGED_EVENT, onWorktree),
  ]);
}

/// Tear down the listeners — used by tests for isolation.
export function unmountRepoLiveRefresh(): void {
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  pendingRefs = false;
  pendingWorktree = false;
  for (const unlisten of unlisteners) unlisten();
  unlisteners = [];
}
