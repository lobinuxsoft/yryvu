// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

export function DeleteRemoteDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () =>
    ops.dialog()?.kind === "delete-remote"
      ? (ops.dialog() as { remote: string; name: string })
      : null;

  return (
    <Dialog
      open={ops.dialog()?.kind === "delete-remote"}
      title="Delete remote branch"
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
            onClick={() => void ops.submitDeleteRemote()}
          >
            Delete remote
          </button>
        </>
      }
    >
      <p>
        Delete{" "}
        <code>
          {state()?.remote}/{state()?.name}
        </code>{" "}
        from the remote? This cannot be undone without push access to the
        remote again.
      </p>
      <p
        style={{
          color: "var(--fg-3)",
          "font-size": "12px",
          "margin-top": "8px",
        }}
      >
        Authentication uses your SSH agent. HTTPS credential helpers will
        land later.
      </p>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
