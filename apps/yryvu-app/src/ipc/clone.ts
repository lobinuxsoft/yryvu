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
  /// When set, the backend reads the integration's stored token from
  /// the keyring and uses it for HTTPS auth. Powers the per-provider
  /// Clone sub-tabs (#374) so users don't need a system git credential
  /// helper configured to clone private repos via OAuth/PAT.
  integrationType?: string;
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
    integrationType: args.integrationType ?? null,
    onProgress: channel,
  });
}

export async function cloneCancel(sessionId: string): Promise<boolean> {
  return invoke<boolean>("clone_cancel", { sessionId });
}
