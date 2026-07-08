// SPDX-License-Identifier: AGPL-3.0-or-later

import { submoduleAutoUpdate } from "../ipc";
import { refreshWorkingTree } from "./refresh";

/**
 * Post-op hook for "Keep submodules up to date" (#98, GK parity).
 * Fired after checkout / merge / pull succeed — the backend resolves
 * the per-repo tri-state against the global preference and runs
 * `git submodule update --init --recursive` when enabled. Best-effort
 * by design: the parent op already succeeded, so a failing submodule
 * update must never surface as if the op failed.
 */
export async function maybeAutoUpdateSubmodules(repoPath: string): Promise<void> {
  try {
    const ran = await submoduleAutoUpdate(repoPath);
    // Submodule pins move with the parent op; the gitlink rows in the
    // working tree settle only after the update lands.
    if (ran) refreshWorkingTree();
  } catch {
    // Advisory hook — drop the error. The setting's surface (the
    // Submodules panel) is where persistent misconfigurations show up.
  }
}
