// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Mirrors `chaja_bridge::backend::WorktreeInfo`. `branch` carries the
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
  main_repo_workdir: string;
}

/**
 * Enumerate the main worktree plus every linked worktree. The first
 * row is always the main one.
 */
export function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>("list_worktrees", { repoPath });
}
