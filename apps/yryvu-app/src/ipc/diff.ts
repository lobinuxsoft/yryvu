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

/// How the diff pane should render a file, mirroring the Rust
/// `FileDataType` enum (kebab-case via `serde(rename_all)`) and
/// GitKraken's `fileDataTypes` (research doc 06). The `DiffView`
/// dispatcher routes on this before the text fallback. `directory` only
/// exists for enum parity — file diffs never carry it.
export type FileDataType =
  | "text"
  | "image"
  | "binary"
  | "submodule"
  | "deleted"
  | "directory";

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

/// One file's diff metadata without the hunk bodies — mirrors Rust
/// `FileDiffMeta`. This is what the combined-diff summary ships (#178):
/// the inspector's file list + stat chips read only these fields, so a
/// huge WIP diff no longer serialises every line across the IPC boundary.
export interface FileDiffMeta {
  path: string;
  old_path: string | null;
  status: FileStatus;
  file_data_type: FileDataType;
  is_binary: boolean;
  truncated: boolean;
  old_size: number;
  new_size: number;
  additions: number;
  deletions: number;
  /// For submodule gitlinks: the pinned commit OIDs before/after the
  /// change. `null` when the side doesn't exist or the file isn't a
  /// submodule. The pointer pane resolves each summary on demand.
  submodule_old_sha: string | null;
  submodule_new_sha: string | null;
  /// Octal file modes ("100644" / "100755" / …) before/after. `null` for
  /// the missing side of an add/delete. Both present + different + no
  /// hunks → the "File Mode Changes" pane.
  old_mode: string | null;
  new_mode: string | null;
}

/// A file's full diff — metadata plus the hunk bodies. Returned by the
/// single-commit / staging IPCs the diff view consumes.
export interface FileDiff extends FileDiffMeta {
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

/// Multi-revision / WIP-aware diff summary for the inspector — mirrors
/// Rust `CombinedDiffSummary`. `shas` is youngest-first to match the
/// frontend's selection ordering. `files` carry no hunks (#178); the diff
/// view fetches a file's hunks on demand via `getCommitDiff` when opened.
export interface CombinedDiffSummary {
  kind: CombinedDiffKind;
  n_commits: number;
  include_workdir: boolean;
  shas: string[];
  files: FileDiffMeta[];
  /// `true` when the backend skipped rename/copy detection because the diff
  /// exceeded its delta threshold (~5000). Header copy can surface a "Rename
  /// detection skipped (large diff)" hint; absent or `false` means renames
  /// were detected normally. Defaults to `false` for back-compat.
  rename_detection_skipped?: boolean;
}

/// Raw file content at one of three sources — backs the INLINE / CONTENT
/// diff view modes (issue #59). HUNK / SPLIT still read from
/// `getUnstagedDiff` / `getStagedDiff` / `getCommitDiff`.
export type FileContentSource =
  | { kind: "working-tree" }
  | { kind: "index" }
  | { kind: "head" }
  | { kind: "commit"; sha: string }
  /// First parent of `sha` — the "before" side of a commit diff. A root
  /// commit resolves to missing, so an added file shows no old side.
  | { kind: "commit-parent"; sha: string };

export interface FileContent {
  content: string;
  isBinary: boolean;
  size: number;
  missing: boolean;
  truncated: boolean;
}

export function readFileContent(
  repoPath: string,
  path: string,
  source: FileContentSource
): Promise<FileContent> {
  return invoke<FileContent>("read_file_content", { repoPath, path, source });
}

/// Raw blob bytes (base64 + MIME) for the image diff viewer (issue #60).
/// `dataBase64` is empty when `missing`.
export interface FileBytes {
  dataBase64: string;
  mime: string;
  size: number;
  missing: boolean;
}

export function readFileBytes(
  repoPath: string,
  path: string,
  source: FileContentSource
): Promise<FileBytes> {
  return invoke<FileBytes>("read_file_bytes", { repoPath, path, source });
}

/// Per-file commit history with rename-following (issue #7).
export interface FileHistoryEntry {
  sha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  time: number;
  summary: string;
  status: FileStatus;
  renamedFrom: string | null;
}

export function getFileHistory(
  repoPath: string,
  path: string,
  max?: number
): Promise<FileHistoryEntry[]> {
  return invoke<FileHistoryEntry[]>("file_history", { repoPath, path, max });
}

/// Per-line blame (issue #8).
export interface BlameLine {
  lineNo: number;
  sha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  time: number;
  summary: string;
  content: string;
  continuesRun: boolean;
}

export interface FileBlame {
  lines: BlameLine[];
  isBinary: boolean;
  size: number;
}

export function getFileBlame(
  repoPath: string,
  path: string,
  sha?: string
): Promise<FileBlame> {
  return invoke<FileBlame>("file_blame", { repoPath, path, sha });
}

/// Destructive single-file checkout. Caller must confirm beforehand.
export function checkoutFileAt(
  repoPath: string,
  path: string,
  sha: string
): Promise<void> {
  return invoke<void>("checkout_file_at", { repoPath, path, sha });
}

/// Metadata-only combined diff for the inspector's file list + stat chips.
/// The per-file hunks are fetched on demand (`getCommitDiff`) when the user
/// opens a file, so this stays cheap even for a 15K-file WIP diff (#178).
export function getCombinedCommitDiffSummary(
  repoPath: string,
  shas: string[],
  includeWorkdir: boolean,
): Promise<CombinedDiffSummary> {
  return invoke<CombinedDiffSummary>("combined_commit_diff_summary", {
    repoPath,
    shas,
    includeWorkdir,
  });
}
