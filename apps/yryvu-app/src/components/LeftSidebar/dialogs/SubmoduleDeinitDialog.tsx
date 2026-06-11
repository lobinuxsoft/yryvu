// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Confirms a submodule deinit (`git submodule deinit -f`): unregisters
 * the submodule and clears its working tree directory, but keeps the
 * `.gitmodules` entry + cached gitdir so Initialize undoes it cheaply.
 * Unlike Remove, nothing is staged — the parent history is untouched.
 */
export function SubmoduleDeinitDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () => {
    const d = ops.dialog();
    return d?.kind === "submodule-deinit" ? d : null;
  };

  return (
    <Dialog
      open={ops.dialog()?.kind === "submodule-deinit"}
      title="Deinitialize submodule"
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
            onClick={() => void ops.submitSubmoduleDeinit()}
          >
            Deinitialize
          </button>
        </>
      }
    >
      <p>
        Deinitialize <strong>{state()?.name}</strong> (
        <code>{state()?.path}</code>)? Its working tree contents will be
        cleared. The <code>.gitmodules</code> entry is kept, so
        "Initialize" restores it without re-cloning.
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
