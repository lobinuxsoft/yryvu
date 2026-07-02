// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Start (or restart) the backend filesystem watcher on `repoPath`. The
/// watcher emits `repo-refs-changed` / `repo-index-changed` /
/// `repo-worktree-changed` events, consumed in `state/repo-live.ts`, so the
/// UI live-refreshes on external edits, terminal `git`, or builds. Replaces
/// any previously-watched repo — call it on every active-repo switch.
export function watchRepo(repoPath: string): Promise<void> {
  return invoke<void>("watch_repo", { repoPath });
}

/// Stop watching. Call when the last repo closes.
export function unwatchRepo(): Promise<void> {
  return invoke<void>("unwatch_repo");
}
