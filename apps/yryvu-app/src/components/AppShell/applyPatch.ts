// SPDX-License-Identifier: AGPL-3.0-or-later

import { open } from "@tauri-apps/plugin-dialog";

import { applyPatch } from "../../ipc";
import {
  refreshBranches,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
} from "../../state";
import { notify } from "../Notifications";

/// `menu:apply-patch` handler (issue #75). Picks an mbox `.patch` / `.mbox`
/// / `.eml` file and applies it onto HEAD as a new commit via `git am`
/// semantics: the author is preserved from the patch headers, the committer
/// is the current user. A malformed or non-applying patch surfaces its
/// reason and leaves the repo untouched (libgit2 apply is atomic).
export async function applyPatchFlow(): Promise<void> {
  const path = repoPath();
  if (!path) {
    // No category — this is a precondition/system toast that must surface
    // even when the user has muted commit notifications.
    notify.error("No repository open", {
      message: "Open a repository before applying a patch.",
    });
    return;
  }

  const selected = await open({
    multiple: false,
    filters: [{ name: "Patch / mbox", extensions: ["patch", "mbox", "eml"] }],
    title: "Select patch file to apply",
  });
  if (typeof selected !== "string") return; // cancelled

  try {
    const result = await applyPatch(path, selected);
    notify.success("Patch applied", {
      message: `${result.new_sha.slice(0, 7)} — ${result.subject}`,
      category: "commit",
    });
    // apply(Both) touches the index + working tree and moves HEAD, so refresh
    // all three surfaces (matches doRevert / doCherryPickOnto).
    refreshWorkingTree();
    refreshGraph();
    refreshBranches();
  } catch (err) {
    notify.error("Apply patch failed", {
      message: String(err),
      category: "commit",
    });
  }
}
