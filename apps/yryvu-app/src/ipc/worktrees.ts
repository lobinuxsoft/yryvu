// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Mirrors `yryvu_bridge::backend::WorktreeInfo`. `branch` carries the
 * short HEAD ref (or the literal `HEAD` for detached worktrees);
 * `head` is the commit SHA. `is_main` flags the main worktree (the
 * only one that can be bare and that cannot be removed). `locked` and
 * `prunable` carry the raw git reasons when present.
 */
export interface WorktreeInfo {
  workdir: string;
  branch: string;
  head: string | null;
  is_main: boolean;
  is_bare: boolean;
  locked: string | null;
  prunable: string | null;
  /// `true` when the worktree's own working tree has uncommitted
  /// changes — the remove dialog warns harder in that case.
  dirty: boolean;
  main_repo_workdir: string;
}

/**
 * Enumerate the main worktree plus every linked worktree. The first
 * row is always the main one.
 */
export function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>("list_worktrees", { repoPath });
}

/// Lock a linked worktree. Reason is optional (shows up in
/// `git worktree list` and the LeftPanel locked badge tooltip).
/// Refuses to lock the main worktree — the menu hides Lock for
/// is_main rows.
export function worktreeLock(
  repoPath: string,
  targetWorkdir: string,
  reason: string | null,
): Promise<void> {
  return invoke<void>("worktree_lock", { repoPath, targetWorkdir, reason });
}

/// Unlock a linked worktree.
export function worktreeUnlock(
  repoPath: string,
  targetWorkdir: string,
): Promise<void> {
  return invoke<void>("worktree_unlock", { repoPath, targetWorkdir });
}

/// Remove a linked worktree. Force-equivalent: prunes the admin dir
/// AND deletes the working-copy directory. Refuses to remove the
/// main worktree — the menu hides Remove for is_main rows. The undo
/// log is cleared on success since the worktree disappearance
/// invalidates every recorded inverse.
export function worktreeRemove(
  repoPath: string,
  targetWorkdir: string,
): Promise<void> {
  return invoke<void>("worktree_remove", { repoPath, targetWorkdir });
}

/// Add a linked worktree at `path` checked out to `branch`. When
/// `createBranch` is set, `branch` is created at `base` (or HEAD) first;
/// otherwise an existing local branch is used.
export function worktreeAdd(
  repoPath: string,
  path: string,
  branch: string,
  base: string | null,
  createBranch: boolean,
): Promise<void> {
  return invoke<void>("worktree_add", {
    repoPath,
    path,
    branch,
    base,
    createBranch,
  });
}

/// Prune every prunable linked worktree. Resolves to the number pruned.
export function worktreePrune(repoPath: string): Promise<number> {
  return invoke<number>("worktree_prune", { repoPath });
}
