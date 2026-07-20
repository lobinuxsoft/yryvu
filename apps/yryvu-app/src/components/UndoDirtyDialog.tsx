// SPDX-License-Identifier: AGPL-3.0-or-later

import { Dialog } from "./Dialog";
import {
  confirmUndoDirtyPrompt,
  dismissUndoDirtyPrompt,
  undoDirtyPrompt,
} from "../undoOps";

/// Confirmation for an undo/redo that would discard uncommitted work.
///
/// Undoing a cherry-pick or a merge has to make the commit's content
/// disappear, so the inverse is a `reset --hard` — which cannot tell that
/// content apart from the user's own uncommitted edits and takes both.
/// Ctrl+Z is a reflex, so the cost is stated before it is paid.
export function UndoDirtyDialog() {
  const prompt = undoDirtyPrompt;
  const verb = () => (prompt()?.kind === "undo" ? "Undo" : "Redo");

  return (
    <Dialog
      open={prompt() !== null}
      title="Uncommitted changes will be lost"
      onClose={dismissUndoDirtyPrompt}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={dismissUndoDirtyPrompt}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--danger"
            type="button"
            onClick={() => void confirmUndoDirtyPrompt()}
          >
            Discard & {verb()}
          </button>
        </>
      }
    >
      <p>
        {verb()}ing <code>{prompt()?.label ?? "this operation"}</code> resets
        the working tree, which discards your uncommitted changes along with
        it.
      </p>
      <p
        style={{
          color: "var(--fg-3)",
          "font-size": "12px",
          "margin-top": "8px",
        }}
      >
        Cancel and commit or stash your work first if you want to keep it —
        uncommitted changes cannot be recovered afterwards, not even by{" "}
        {prompt()?.kind === "undo" ? "Redo" : "Undo"}.
      </p>
    </Dialog>
  );
}
