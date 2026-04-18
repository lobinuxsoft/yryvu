// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface RefTag {
  name: string;
  kind: "Branch" | "RemoteBranch" | "Tag" | "Head";
}

export interface GraphRow {
  sha: string;
  short_sha: string;
  summary: string;
  author: string;
  author_date: number;
  lane: number;
  parent_lanes: number[];
  color_idx: number;
  refs: RefTag[];
  is_merge: boolean;
}

interface GraphBatch {
  rows: GraphRow[];
  done: boolean;
}

export interface StreamHandle {
  stop: () => void;
  promise: Promise<void>;
}

/**
 * Invokes `stream_graph` on the Rust side and emits row batches via `onBatch`.
 * Resolves when the Rust task signals `done`.
 */
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

export type MergeStrategy =
  | "fast-forward-only"
  | "fast-forward-or-merge"
  | "no-fast-forward";

export type MergeResult =
  | { kind: "already-up-to-date" }
  | { kind: "fast-forward"; new_head: string }
  | { kind: "merged"; new_head: string }
  | { kind: "conflict"; paths: string[] };

export function isWorkingTreeDirty(repoPath: string): Promise<boolean> {
  return invoke<boolean>("is_working_tree_dirty", { repoPath });
}

export function checkoutBranch(repoPath: string, name: string): Promise<void> {
  return invoke<void>("checkout_branch", { repoPath, name });
}

export function stashPush(repoPath: string, message?: string): Promise<void> {
  return invoke<void>("stash_push", { repoPath, message });
}

export function stashPop(repoPath: string): Promise<void> {
  return invoke<void>("stash_pop", { repoPath });
}

export function mergeBranch(
  repoPath: string,
  source: string,
  strategy: MergeStrategy,
): Promise<MergeResult> {
  return invoke<MergeResult>("merge_branch", { repoPath, source, strategy });
}

export function deleteRemoteBranch(
  repoPath: string,
  remote: string,
  name: string,
): Promise<void> {
  return invoke<void>("delete_remote_branch", { repoPath, remote, name });
}

export function abortMerge(repoPath: string): Promise<void> {
  return invoke<void>("abort_merge", { repoPath });
}

export interface RepoStateInfo {
  kind:
    | "clean"
    | "merge"
    | "rebase"
    | "cherry-pick"
    | "revert"
    | "bisect"
    | "apply-mailbox"
    | string;
  conflict_paths: string[];
}

export function getRepoState(repoPath: string): Promise<RepoStateInfo> {
  return invoke<RepoStateInfo>("repo_state", { repoPath });
}

export function fetchPrune(repoPath: string, remote?: string): Promise<void> {
  return invoke<void>("fetch_prune", { repoPath, remote });
}

export function streamGraph(
  repoPath: string,
  onBatch: (rows: GraphRow[]) => void,
  batchSize = 100,
): StreamHandle {
  let unlisten: UnlistenFn | undefined;
  let resolve!: () => void;
  let reject!: (err: unknown) => void;

  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  (async () => {
    try {
      unlisten = await listen<GraphBatch>("graph:batch", (e) => {
        if (e.payload.rows.length > 0) onBatch(e.payload.rows);
        if (e.payload.done) {
          unlisten?.();
          resolve();
        }
      });
      await invoke("stream_graph", { repoPath, batchSize });
    } catch (err) {
      unlisten?.();
      reject(err);
    }
  })();

  return {
    stop: () => unlisten?.(),
    promise,
  };
}
