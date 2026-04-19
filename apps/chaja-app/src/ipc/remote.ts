// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

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
