// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

export type FileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-change"
  | "unmodified"
  | "other";

export type LineKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: LineKind;
  content: string;
  old_line_no: number | null;
  new_line_no: number | null;
}

export interface DiffHunk {
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  old_path: string | null;
  status: FileStatus;
  is_binary: boolean;
  truncated: boolean;
  old_size: number;
  new_size: number;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface CommitDiff {
  sha: string;
  parent_sha: string | null;
  files: FileDiff[];
}

export function getCommitDiff(repoPath: string, sha: string): Promise<CommitDiff> {
  return invoke<CommitDiff>("commit_diff", { repoPath, sha });
}

/// Selection variant the inspector renders. Mirrors the Rust enum
/// `CombinedDiffKind` (kebab-case via `serde(rename_all)`).
export type CombinedDiffKind =
  | "single"
  | "multi"
  | "wip-only"
  | "commit-vs-wip"
  | "multi-vs-wip";

/// Multi-revision / WIP-aware diff. `shas` is youngest-first to match the
/// frontend's selection ordering.
export interface CombinedDiff {
  kind: CombinedDiffKind;
  n_commits: number;
  include_workdir: boolean;
  shas: string[];
  files: FileDiff[];
}

export function getCombinedCommitDiff(
  repoPath: string,
  shas: string[],
  includeWorkdir: boolean,
): Promise<CombinedDiff> {
  return invoke<CombinedDiff>("combined_commit_diff", {
    repoPath,
    shas,
    includeWorkdir,
  });
}
