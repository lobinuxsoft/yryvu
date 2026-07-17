// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import { isWorkingTreeDirtyError, redoLastUndo, undoLastOperation } from "./ipc";
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

/// A destructive undo/redo the backend refused because the working tree is
/// dirty, parked until the user answers the dialog. Undo is a reflex — the
/// user gets told what it would cost before it happens.
export type UndoDirtyPrompt = {
  kind: "undo" | "redo";
  label: string | undefined;
};

const [undoDirtyPrompt, setUndoDirtyPrompt] =
  createSignal<UndoDirtyPrompt | null>(null);
export { undoDirtyPrompt };

export function dismissUndoDirtyPrompt(): void {
  setUndoDirtyPrompt(null);
}

/// The user accepted losing their uncommitted work — re-run with force.
export async function confirmUndoDirtyPrompt(): Promise<void> {
  const prompt = undoDirtyPrompt();
  setUndoDirtyPrompt(null);
  if (!prompt) return;
  await runWithToast(prompt.kind, prompt.label, true);
}

/// In-flight guard: a second undo/redo must not overlap the first. The
/// backend reads the sidecar cursor before the first call's set_cursor
/// lands, so two concurrent HEAD-relative inverses (cherry-pick/revert)
/// would each drop a commit while the cursor steps back once (#472). JS is
/// single-threaded, so a plain module flag is race-free — this only guards
/// async re-entry, not true parallelism.
let inFlight = false;

async function runWithToast(
  kind: "undo" | "redo",
  label: string | undefined,
  force = false,
): Promise<void> {
  const path = repoPath();
  if (!path) return;
  if (inFlight) return;
  inFlight = true;
  const human = label ?? "operation";
  try {
    const outcome =
      kind === "undo"
        ? await undoLastOperation(path, force)
        : await redoLastUndo(path, force);
    if (outcome.outcome === "applied") {
      notify.success(kind === "undo" ? "Undone" : "Redone", {
        message: outcome.kind_label,
        category: "undoRedo",
      });
    } else {
      notify.info(kind === "undo" ? "Cannot undo" : "Cannot redo", {
        message: outcome.reason,
        category: "undoRedo",
      });
    }
  } catch (err) {
    // Not a failure: the backend is asking whether the uncommitted work is
    // expendable. Park the op and let the dialog decide.
    if (isWorkingTreeDirtyError(err)) {
      setUndoDirtyPrompt({ kind, label });
      return;
    }
    notify.error(
      `${kind === "undo" ? "Undo" : "Redo"} of ${human} failed`,
      { message: String(err), category: "undoRedo" },
    );
  } finally {
    inFlight = false;
  }
  refreshGraph();
  refreshBranches();
  refreshWorkingTree();
  refreshUndoRedo();
}

export async function runUndo(): Promise<void> {
  if (!undoRedoState()?.can_undo) {
    notify.info("Nothing to undo", { category: "undoRedo" });
    return;
  }
  await runWithToast("undo", undoRedoState()?.undo_label ?? undefined);
}

export async function runRedo(): Promise<void> {
  if (!undoRedoState()?.can_redo) {
    notify.info("Nothing to redo", { category: "undoRedo" });
    return;
  }
  await runWithToast("redo", undoRedoState()?.redo_label ?? undefined);
}
