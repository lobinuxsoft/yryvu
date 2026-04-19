// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../useBranchOps";

export function RenameDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  return (
    <Dialog
      open={ops.dialog()?.kind === "rename"}
      title="Rename branch"
      onClose={ops.closeDialog}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={ops.closeDialog}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            disabled={!ops.dialogNameInput().trim()}
            onClick={ops.submitRename}
          >
            Rename
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="rename-branch-name">New name</label>
        <input
          id="rename-branch-name"
          type="text"
          value={ops.dialogNameInput()}
          onInput={(e) => ops.setDialogNameInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ops.submitRename();
          }}
        />
      </div>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
