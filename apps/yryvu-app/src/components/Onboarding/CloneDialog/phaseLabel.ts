// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClonePhase } from "../../../ipc";

/// Map the libgit2 clone phase tag to a user-readable label shown
/// above the progress bar. `undefined` (the pre-first-callback
/// state) resolves to `"Starting"` so the bar always has a label.
export function phaseLabel(phase: ClonePhase | undefined): string {
  switch (phase) {
    case "counting":
      return "Counting objects";
    case "compressing":
      return "Compressing";
    case "receiving":
      return "Receiving objects";
    case "resolving":
      return "Resolving deltas";
    case "checkout":
      return "Checking out files";
    default:
      return "Starting";
  }
}
