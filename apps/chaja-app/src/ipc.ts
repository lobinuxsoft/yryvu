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
