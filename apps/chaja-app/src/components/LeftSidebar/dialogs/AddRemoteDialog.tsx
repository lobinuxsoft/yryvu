// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Add-remote dialog. Two required inputs (name + URL) — name uses
 * `dialogNameInput`, URL repurposes `dialogPathInput` to avoid a third
 * signal. Submit calls `add_remote` which validates the name shape and
 * rejects duplicates with typed errors surfaced inline.
 */
export function AddRemoteDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const canSubmit = () =>
    ops.dialogNameInput().trim().length > 0 &&
    ops.dialogPathInput().trim().length > 0;

  return (
    <Dialog
      open={ops.dialog()?.kind === "add-remote"}
      title="Add remote"
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
            disabled={!canSubmit()}
            onClick={() => void ops.submitAddRemote()}
          >
            Add
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="add-remote-name">Name</label>
        <input
          id="add-remote-name"
          type="text"
          value={ops.dialogNameInput()}
          placeholder="upstream"
          onInput={(e) => ops.setDialogNameInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit()) {
              void ops.submitAddRemote();
            }
          }}
        />
      </div>
      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="add-remote-url">Fetch URL</label>
        <input
          id="add-remote-url"
          type="text"
          value={ops.dialogPathInput()}
          placeholder="git@github.com:user/repo.git"
          onInput={(e) => ops.setDialogPathInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit()) {
              void ops.submitAddRemote();
            }
          }}
        />
      </div>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
