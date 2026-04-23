// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

import type { FileDiff, FileStatus } from "./diff";

export interface WorkingTreeChange {
  path: string;
  old_path: string | null;
  status: FileStatus;
}

export interface WorkingTreeStatus {
  unstaged: WorkingTreeChange[];
  staged: WorkingTreeChange[];
}

export function getWorkingTreeStatus(
  repoPath: string
): Promise<WorkingTreeStatus> {
  return invoke<WorkingTreeStatus>("working_tree_status", { repoPath });
}

export function stageFiles(repoPath: string, paths: string[]): Promise<void> {
  return invoke<void>("stage_files", { repoPath, paths });
}

export function unstageFiles(repoPath: string, paths: string[]): Promise<void> {
  return invoke<void>("unstage_files", { repoPath, paths });
}

export function getUnstagedDiff(
  repoPath: string,
  path: string
): Promise<FileDiff> {
  return invoke<FileDiff>("diff_unstaged", { repoPath, path });
}

export function getStagedDiff(
  repoPath: string,
  path: string
): Promise<FileDiff> {
  return invoke<FileDiff>("diff_staged", { repoPath, path });
}

export function commitStaged(
  repoPath: string,
  message: string
): Promise<string> {
  return invoke<string>("commit_staged", { repoPath, message });
}

export function amendCommit(
  repoPath: string,
  message: string
): Promise<string> {
  return invoke<string>("amend_commit", { repoPath, message });
}

export function getHeadCommitMessage(repoPath: string): Promise<string> {
  return invoke<string>("head_commit_message", { repoPath });
}

export function stageAll(repoPath: string): Promise<string[]> {
  return invoke<string[]>("stage_all", { repoPath });
}

export function unstageAll(repoPath: string): Promise<string[]> {
  return invoke<string[]>("unstage_all", { repoPath });
}

/// Destructively revert unstaged changes. Tracked paths snap back to HEAD;
/// untracked files are deleted from disk. Caller must confirm with the user
/// beforehand — there is no undo.
export function discardPaths(
  repoPath: string,
  paths: string[]
): Promise<void> {
  return invoke<void>("discard_paths", { repoPath, paths });
}

/// Options bundle mirroring the backend `CommitOptions` (serde camelCase).
/// `skipHooks` is a no-op on the git2 backend — kept for API parity.
/// `gpgSign=true` currently errors with `NotImplemented`.
export interface CommitOptions {
  summary: string;
  description?: string;
  amend?: boolean;
  skipHooks?: boolean;
  gpgSign?: boolean;
}

export function createCommit(
  repoPath: string,
  options: CommitOptions
): Promise<string> {
  return invoke<string>("create_commit", { repoPath, options });
}

export function commitAndPush(
  repoPath: string,
  options: CommitOptions
): Promise<string> {
  return invoke<string>("commit_and_push", { repoPath, options });
}
