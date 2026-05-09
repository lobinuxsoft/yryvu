// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

export type RepoStatus = "valid" | "not-a-repo" | "inaccessible-path";

export async function validateGitRepo(path: string): Promise<RepoStatus> {
  return invoke<RepoStatus>("validate_git_repo", { path });
}
