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
