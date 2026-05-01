// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

export function isWorkingTreeDirty(repoPath: string): Promise<boolean> {
  return invoke<boolean>("is_working_tree_dirty", { repoPath });
}

export function checkoutBranch(repoPath: string, name: string): Promise<void> {
  return invoke<void>("checkout_branch", { repoPath, name });
}

/**
 * Checkout a remote-tracking ref by creating-or-switching to a local
 * branch that tracks it. `fullRemoteName` is the short form returned by
 * `listBranches` for `kind: "remote"` rows — e.g. `origin/feature-x`
 * (no `refs/remotes/` prefix).
 */
export function checkoutRemoteTracking(
  repoPath: string,
  fullRemoteName: string,
): Promise<void> {
  return invoke<void>("checkout_remote_tracking", {
    repoPath,
    fullRemoteName,
  });
}

export function stashPush(repoPath: string, message?: string): Promise<void> {
  return invoke<void>("stash_push", { repoPath, message });
}

export function stashPop(repoPath: string): Promise<void> {
  return invoke<void>("stash_pop", { repoPath });
}

export function stashCount(repoPath: string): Promise<number> {
  return invoke<number>("stash_count", { repoPath });
}

export interface RepoStateInfo {
  kind:
    | "clean"
    | "merge"
    | "rebase"
    | "cherry-pick"
    | "revert"
    | "bisect"
    | "apply-mailbox"
    | string;
  conflict_paths: string[];
}

export function getRepoState(repoPath: string): Promise<RepoStateInfo> {
  return invoke<RepoStateInfo>("repo_state", { repoPath });
}
