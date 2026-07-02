// SPDX-License-Identifier: AGPL-3.0-or-later

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  localRefreshWithin,
  setBranchesNonce,
  setGraphNonce,
  setWorkingTreeNonce,
} from "./refresh";

/// Granular events emitted by the backend repo watcher. Must match the
/// constants in `crates/yryvu-bridge/src/repo/watcher.rs`.
const REFS_CHANGED_EVENT = "repo-refs-changed";
const INDEX_CHANGED_EVENT = "repo-index-changed";
const WORKTREE_CHANGED_EVENT = "repo-worktree-changed";

/// Covers the watcher's 400 ms debounce plus margin. The echo of a *local*
/// mutation fires ~one debounce after the op (inside the window → suppressed);
/// a genuinely external change fires a full debounce after its own last
/// filesystem write, which — since it postdates any local refresh — lands
/// outside the window and refreshes normally. See `refresh.ts` for the
/// stamping side.
const SELF_ECHO_WINDOW_MS = 550;

let unlisteners: UnlistenFn[] = [];

/// Bump nonces *directly* (not via `refreshGraph` / `refreshWorkingTree`) so a
/// watcher-driven refresh never stamps the self-echo clock — otherwise the
/// refs/index/worktree trio emitted by a single commit would suppress one
/// another.
function refreshRefs() {
  setGraphNonce((n) => n + 1);
  setBranchesNonce((n) => n + 1);
}

function refreshWorktree() {
  setWorkingTreeNonce((n) => n + 1);
}

/// Subscribe to the backend repo-watcher events so the UI live-refreshes on
/// external edits, terminal `git`, and builds. Idempotent — a second call is
/// a no-op until [`unmountRepoLiveRefresh`] runs. The watcher itself is
/// started per-repo from `state/repo.ts`; this only wires the listeners.
export async function mountRepoLiveRefresh(): Promise<void> {
  if (unlisteners.length) return;

  const onRefs = () => {
    if (!localRefreshWithin(SELF_ECHO_WINDOW_MS)) refreshRefs();
  };
  const onWorktree = () => {
    if (!localRefreshWithin(SELF_ECHO_WINDOW_MS)) refreshWorktree();
  };

  unlisteners = await Promise.all([
    listen(REFS_CHANGED_EVENT, onRefs),
    listen(INDEX_CHANGED_EVENT, onWorktree),
    listen(WORKTREE_CHANGED_EVENT, onWorktree),
  ]);
}

/// Tear down the listeners — used by tests for isolation.
export function unmountRepoLiveRefresh(): void {
  for (const unlisten of unlisteners) unlisten();
  unlisteners = [];
}
