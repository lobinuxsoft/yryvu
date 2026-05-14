// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `yryvu_bridge::commands::repo_management::KnownRepoInfo`.
/// `error` is non-null when the repo couldn't be opened or scanned —
/// the row still renders in a "stale" visual state instead of bringing
/// the whole list down.
export interface KnownRepoInfo {
  path: string;
  name: string;
  currentBranch: string | null;
  dirtyCount: number;
  error: string | null;
}

export function listKnownRepos(paths: string[]): Promise<KnownRepoInfo[]> {
  return invoke<KnownRepoInfo[]>("list_known_repos", { paths });
}
