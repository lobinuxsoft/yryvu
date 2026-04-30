// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Mirrors `chaja_bridge::backend::StashInfo`. `parent_sha` is the WIP
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
