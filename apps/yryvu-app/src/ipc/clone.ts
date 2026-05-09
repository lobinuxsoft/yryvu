// SPDX-License-Identifier: AGPL-3.0-or-later

import { Channel, invoke } from "@tauri-apps/api/core";

export type ClonePhase = "counting" | "compressing" | "receiving" | "resolving" | "checkout";

export interface CloneProgress {
  phase: ClonePhase;
  percent: number;
  current: number;
  total: number;
}

export interface CloneRepositoryArgs {
  sessionId: string;
  url: string;
  destPath: string;
  branch?: string;
  depth?: number;
  recurseSubmodules: boolean;
  onProgress: (p: CloneProgress) => void;
}

/// Returns the canonical path of the cloned repository.
export async function cloneRepository(args: CloneRepositoryArgs): Promise<string> {
  const channel = new Channel<CloneProgress>();
  channel.onmessage = (msg) => args.onProgress(msg);
  return invoke<string>("clone_repository", {
    sessionId: args.sessionId,
    url: args.url,
    destPath: args.destPath,
    branch: args.branch,
    depth: args.depth,
    recurseSubmodules: args.recurseSubmodules,
    onProgress: channel,
  });
}

export async function cloneCancel(sessionId: string): Promise<boolean> {
  return invoke<boolean>("clone_cancel", { sessionId });
}
