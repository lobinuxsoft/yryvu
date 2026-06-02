// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

export function WorktreeRemoveDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () => {
    const d = ops.dialog();
    return d?.kind === "worktree-remove" ? d : null;
  };

  return (
    <Dialog
      open={state() !== null}
      title="Remove worktree"
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
            class="dialog__btn dialog__btn--danger"
            type="button"
            onClick={ops.submitWorktreeRemove}
          >
            Remove
          </button>
        </>
      }
    >
      <p>
        Remove the worktree for <strong>{state()?.branch}</strong> at{" "}
        <code>{state()?.workdir}</code>? The working directory will be deleted.
      </p>
      <Show when={state()?.dirty}>
        <p class="dialog__error">
          This worktree has uncommitted changes — they will be lost.
        </p>
      </Show>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
