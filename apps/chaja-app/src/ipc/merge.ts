// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

export type MergeStrategy =
  | "fast-forward-only"
  | "fast-forward-or-merge"
  | "no-fast-forward";

export type MergeResult =
  | { kind: "already-up-to-date" }
  | { kind: "fast-forward"; new_head: string }
  | { kind: "merged"; new_head: string }
  | { kind: "conflict"; paths: string[] };

export function mergeBranch(
  repoPath: string,
  source: string,
  strategy: MergeStrategy,
): Promise<MergeResult> {
  return invoke<MergeResult>("merge_branch", { repoPath, source, strategy });
}

export function abortMerge(repoPath: string): Promise<void> {
  return invoke<void>("abort_merge", { repoPath });
}
