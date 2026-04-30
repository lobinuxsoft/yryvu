// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Mirrors `chaja_bridge::backend::SubmoduleInfo`. `head_sha` is the
 * SHA the parent's HEAD tree pins the submodule to; `index_sha` is
 * what the parent's index has staged. `ahead` / `behind` compare the
 * submodule's checked-out HEAD against the parent-pinned commit, and
 * are zero whenever the comparison can't be performed (uninitialized
 * submodule, missing inner repo, missing commit objects).
 */
export interface SubmoduleInfo {
  name: string;
  path: string;
  url: string | null;
  head_sha: string | null;
  index_sha: string | null;
  is_initialized: boolean;
  is_deleted: boolean;
  ahead: number;
  behind: number;
}

/**
 * Enumerate every submodule declared in `.gitmodules`. Returns an
 * empty array for repos without submodules.
 */
export function listSubmodules(repoPath: string): Promise<SubmoduleInfo[]> {
  return invoke<SubmoduleInfo[]>("list_submodules", { repoPath });
}

/// Initialize a submodule + clone its working tree to the parent-pinned
/// commit. Equivalent to `git submodule update --init <name>`.
export function submoduleInit(repoPath: string, name: string): Promise<void> {
  return invoke<void>("submodule_init", { repoPath, name });
}

/// Fetch + checkout the parent-pinned commit in an already-initialized
/// submodule. Equivalent to `git submodule update <name>`.
export function submoduleUpdate(repoPath: string, name: string): Promise<void> {
  return invoke<void>("submodule_update", { repoPath, name });
}
