// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

export type ConflictSource =
  | "merge"
  | "rebase"
  | "interactive-rebase"
  | "cherry-pick"
  | "revert"
  | "bisect"
  | "standalone";

export type ConflictSide = "ours" | "theirs" | "base";

export interface ConflictedFile {
  path: string;
  has_ancestor: boolean;
  has_ours: boolean;
  has_theirs: boolean;
}

export interface ConflictListing {
  source: ConflictSource;
  files: ConflictedFile[];
}

export interface ConflictDiff3 {
  base: string | null;
  ours: string | null;
  theirs: string | null;
  working: string;
}

export function listConflicts(repoPath: string) {
  return invoke<ConflictListing>("list_conflicts", { repoPath });
}

export function readConflictDiff3(repoPath: string, path: string) {
  return invoke<ConflictDiff3>("read_conflict_diff3", { repoPath, path });
}

export function acceptConflictSide(repoPath: string, path: string, side: ConflictSide) {
  return invoke<void>("accept_conflict_side", { repoPath, path, side });
}

export function resolveConflictWithContent(repoPath: string, path: string, content: string) {
  return invoke<void>("resolve_conflict_with_content", { repoPath, path, content });
}

export function markConflictResolved(repoPath: string, path: string) {
  return invoke<void>("mark_conflict_resolved", { repoPath, path });
}

export function finishInProgressOp(repoPath: string) {
  return invoke<ConflictSource>("finish_in_progress_op", { repoPath });
}
