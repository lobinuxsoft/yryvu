// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function checkoutCommit(repoPath: string, sha: string): Promise<void> {
  return invoke<void>("checkout_commit", { repoPath, sha });
}

export type ResetMode = "soft" | "mixed" | "hard";

export function resetToCommit(
  repoPath: string,
  sha: string,
  mode: ResetMode,
): Promise<void> {
  return invoke<void>("reset_to_commit", { repoPath, sha, mode });
}

export function cherryPickCommit(repoPath: string, sha: string): Promise<void> {
  return invoke<void>("cherry_pick_commit", { repoPath, sha });
}

export function revertCommit(repoPath: string, sha: string): Promise<void> {
  return invoke<void>("revert_commit", { repoPath, sha });
}

export function formatPatch(
  repoPath: string,
  sha: string,
  outDir: string,
): Promise<string> {
  return invoke<string>("format_patch", { repoPath, sha, outDir });
}

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
  parent_shas: string[];
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
