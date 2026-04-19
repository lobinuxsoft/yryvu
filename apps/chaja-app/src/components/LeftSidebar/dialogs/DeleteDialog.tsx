// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../useBranchOps";

export function DeleteDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () =>
    ops.dialog()?.kind === "delete"
      ? (ops.dialog() as { name: string; unmerged?: boolean })
      : null;

  return (
    <Dialog
      open={ops.dialog()?.kind === "delete"}
      title={
        state()?.unmerged ? "Force delete unmerged branch?" : "Delete branch"
      }
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
            onClick={() => ops.submitDelete(Boolean(state()?.unmerged))}
          >
            {state()?.unmerged ? "Force delete" : "Delete"}
          </button>
        </>
      }
    >
      <Show
        when={state()?.unmerged}
        fallback={
          <p>
            Delete local branch <code>{state()?.name}</code>?
          </p>
        }
      >
        <p>
          Branch <code>{state()?.name}</code> is not fully merged into HEAD.
          Deleting it may lose commits.
        </p>
      </Show>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
