// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Edit-remote dialog. Updates the fetch URL of an existing remote;
 * name is rendered immutable since libgit2 lacks a single-call rename
 * (delete+add would force a re-fetch of the local tracking refs).
 * URL input reuses `dialogNameInput` (single-field dialog).
 */
export function EditRemoteDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () => {
    const d = ops.dialog();
    return d?.kind === "edit-remote" ? d : null;
  };
  const canSubmit = () => ops.dialogNameInput().trim().length > 0;

  return (
    <Dialog
      open={ops.dialog()?.kind === "edit-remote"}
      title={`Edit remote ${state()?.name ?? ""}`}
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
            onClick={() => void ops.submitEditRemote()}
          >
            Save
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="edit-remote-url">Fetch URL</label>
        <input
          id="edit-remote-url"
          type="text"
          value={ops.dialogNameInput()}
          placeholder="git@github.com:user/repo.git"
          onInput={(e) => ops.setDialogNameInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit()) {
              void ops.submitEditRemote();
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
