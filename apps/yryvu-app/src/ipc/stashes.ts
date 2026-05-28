// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

import type { CommitDiff } from "./diff";

/**
 * Mirrors `yryvu_bridge::backend::StashInfo`. `parent_sha` is the WIP
 * base commit (where HEAD was when stashed); `index_sha` and
 * `untracked_sha` come from the stash commit's parent slots so the
 * inspector can diff index-only or untracked-only views without
 * fetching the commit. `branch_name` is parsed from the canonical
 * git stash message format and is `null` for non-canonical messages.
 */
export interface StashInfo {
  sha: string;
  message: string;
  branch_name: string | null;
  parent_sha: string;
  index_sha: string | null;
  untracked_sha: string | null;
  when: number;
}

/**
 * Walk the reflog of `refs/stash`, newest-first. Returns an empty
 * array when no stash has ever been taken in the repo.
 */
export function listStashes(repoPath: string): Promise<StashInfo[]> {
  return invoke<StashInfo[]>("list_stashes", { repoPath });
}

/// Pop a specific stash entry — applies to working tree AND removes
/// from the queue. `index` is the LIFO position from `listStashes`
/// (0 = top). Equivalent to `git stash pop stash@{index}`.
export function stashPopAt(repoPath: string, index: number): Promise<void> {
  return invoke<void>("stash_pop_at", { repoPath, index });
}

/// Apply a stash entry to the working tree without removing it from
/// the queue. Equivalent to `git stash apply stash@{index}`.
export function stashApply(repoPath: string, index: number): Promise<void> {
  return invoke<void>("stash_apply", { repoPath, index });
}

/// Drop a stash entry without applying it. Equivalent to `git stash
/// drop stash@{index}`. The stash sha lives in the objects DB until
/// GC (~90 days) so undo can resurrect it.
export function stashDrop(repoPath: string, index: number): Promise<void> {
  return invoke<void>("stash_drop", { repoPath, index });
}

/// Diff `stash@{index}` against its primary parent (HEAD-at-stash-time).
/// Powers the StashDetails right-panel inspector (issue #173). Reuses
/// the standard `CommitDiff` shape so the FileList renderer can mount
/// the diff without a special path for stashes.
export function stashDiff(
  repoPath: string,
  index: number,
): Promise<CommitDiff> {
  return invoke<CommitDiff>("stash_diff", { repoPath, index });
}
