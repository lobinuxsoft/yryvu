// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Confirms a submodule reset (`git submodule update --force`): the
 * inner working tree is force-checked-out to the parent-pinned commit,
 * discarding local commits ahead of the pin AND uncommitted changes.
 * The copy warns harder when the row is dirty (issue #98).
 */
export function SubmoduleResetDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () => {
    const d = ops.dialog();
    return d?.kind === "submodule-reset" ? d : null;
  };

  return (
    <Dialog
      open={ops.dialog()?.kind === "submodule-reset"}
      title="Reset submodule"
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
            onClick={() => void ops.submitSubmoduleReset()}
          >
            Reset
          </button>
        </>
      }
    >
      <p>
        Reset <strong>{state()?.name}</strong> to the commit pinned by this
        repo? The submodule's working tree will be checked out to that
        commit.
      </p>
      <Show when={state()?.dirty}>
        <p class="dialog__warning">
          This submodule has uncommitted changes — they will be discarded
          and cannot be recovered.
        </p>
      </Show>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
