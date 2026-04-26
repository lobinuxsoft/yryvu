// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

import type { MergeResult, MergeStrategy } from "./merge";

export function deleteRemoteBranch(
  repoPath: string,
  remote: string,
  name: string,
): Promise<void> {
  return invoke<void>("delete_remote_branch", { repoPath, remote, name });
}

export function fetchPrune(repoPath: string, remote?: string): Promise<void> {
  return invoke<void>("fetch_prune", { repoPath, remote });
}

/**
 * Push customisation surface. Mirrors the backend `PushOptions` struct.
 * Bare `--force` is intentionally absent — chajá refuses to expose it
 * from the UI; use {@link push} with `forceWithLease` instead.
 */
export interface PushOptions {
  /**
   * Allow a non-fast-forward push **only** if the remote tip still matches
   * the local tracking ref. The lease check happens in the push-negotiation
   * callback; mismatches return a `lease-stale` error mentioning the ref.
   */
  forceWithLease?: boolean;
}

export function push(repoPath: string, options?: PushOptions): Promise<void> {
  return invoke<void>("push", { repoPath, options: options ?? null });
}

/**
 * Pull HEAD's branch from a remote: fetch the remote-tracking ref and
 * merge it into HEAD with the requested strategy. `remote` defaults to
 * the upstream's remote when omitted; pass an explicit value to force a
 * different remote (toolbar dropdown). Strategies match `merge_branch`:
 * `fast-forward-only`, `fast-forward-or-merge`, `no-fast-forward`.
 */
export function pull(
  repoPath: string,
  strategy: MergeStrategy,
  remote?: string,
): Promise<MergeResult> {
  return invoke<MergeResult>("pull", { repoPath, remote: remote ?? null, strategy });
}
