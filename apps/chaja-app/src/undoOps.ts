// SPDX-License-Identifier: AGPL-3.0-or-later

import { redoLastUndo, undoLastOperation } from "./ipc";
import { notify } from "./components/Notifications";
import {
  refreshBranches,
  refreshGraph,
  refreshUndoRedo,
  refreshWorkingTree,
  repoPath,
  undoRedoState,
} from "./state";

/// Shared Undo / Redo orchestrator. Lives outside the Toolbar component
/// so the keyboard-shortcut listener in AppShell can fire the same code
/// path without copy-pasting toast / refresh logic.

async function runWithToast(
  kind: "undo" | "redo",
  label: string | undefined,
): Promise<void> {
  const path = repoPath();
  if (!path) return;
  const human = label ?? "operation";
  try {
    const outcome =
      kind === "undo"
        ? await undoLastOperation(path)
        : await redoLastUndo(path);
    if (outcome.outcome === "applied") {
      notify.success(kind === "undo" ? "Undone" : "Redone", {
        message: outcome.kind_label,
      });
    } else {
      notify.info(kind === "undo" ? "Cannot undo" : "Cannot redo", {
        message: outcome.reason,
      });
    }
  } catch (err) {
    notify.error(
      `${kind === "undo" ? "Undo" : "Redo"} of ${human} failed`,
      { message: String(err) },
    );
  }
  refreshGraph();
  refreshBranches();
  refreshWorkingTree();
  refreshUndoRedo();
}

export async function runUndo(): Promise<void> {
  if (!undoRedoState()?.can_undo) {
    notify.info("Nothing to undo");
    return;
  }
  await runWithToast("undo", undoRedoState()?.undo_label ?? undefined);
}

export async function runRedo(): Promise<void> {
  if (!undoRedoState()?.can_redo) {
    notify.info("Nothing to redo");
    return;
  }
  await runWithToast("redo", undoRedoState()?.redo_label ?? undefined);
}
