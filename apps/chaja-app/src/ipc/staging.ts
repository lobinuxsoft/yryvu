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
