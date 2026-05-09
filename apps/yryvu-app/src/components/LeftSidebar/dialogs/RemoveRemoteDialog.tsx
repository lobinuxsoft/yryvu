// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Confirm dialog for removing a configured remote. Drops the config
 * entry plus all `refs/remotes/<name>/*` tracking refs in one backend
 * call — local branches that tracked the remote keep their config but
 * the upstream lookup will fail until the user re-adds or re-points it.
 */
export function RemoveRemoteDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () => {
    const d = ops.dialog();
    return d?.kind === "remove-remote" ? d : null;
  };

  return (
    <Dialog
      open={ops.dialog()?.kind === "remove-remote"}
      title="Remove remote"
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
            onClick={() => void ops.submitRemoveRemote()}
          >
            Remove
          </button>
        </>
      }
    >
      <p>
        Remove <code>{state()?.name}</code> and all of its tracking refs?
      </p>
      <p
        style={{
          color: "var(--fg-3)",
          "font-size": "12px",
          "margin-top": "8px",
        }}
      >
        Local branches that tracked this remote will lose their upstream
        until you re-add or re-point the configuration.
      </p>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
