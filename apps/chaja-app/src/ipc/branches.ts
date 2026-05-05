// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

export type BranchKind = "local" | "remote";

export interface BranchInfo {
  name: string;
  full_name: string;
  kind: BranchKind;
  tip_sha: string;
  is_head: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export function listBranches(repoPath: string): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>("list_branches", { repoPath });
}

export function createBranch(
  repoPath: string,
  name: string,
  from?: string,
): Promise<void> {
  return invoke<void>("create_branch", { repoPath, name, from });
}

export function deleteLocalBranch(
  repoPath: string,
  name: string,
  force = false,
): Promise<void> {
  return invoke<void>("delete_local_branch", { repoPath, name, force });
}

export function renameBranch(
  repoPath: string,
  oldName: string,
  newName: string,
): Promise<void> {
  return invoke<void>("rename_branch", { repoPath, oldName, newName });
}

/// Rebase the current branch onto `targetBranch`. Aborts on conflict
/// (chajá doesn't yet expose per-step resolution).
export function rebaseCurrentOnto(
  repoPath: string,
  targetBranch: string,
): Promise<void> {
  return invoke<void>("rebase_current_onto", { repoPath, targetBranch });
}

/// Set or clear the upstream tracking config for a local branch.
/// Pass `null` to clear, or `"origin/main"` to track that ref.
export function setUpstream(
  repoPath: string,
  branchName: string,
  upstream: string | null,
): Promise<void> {
  return invoke<void>("set_upstream", { repoPath, branchName, upstream });
}
