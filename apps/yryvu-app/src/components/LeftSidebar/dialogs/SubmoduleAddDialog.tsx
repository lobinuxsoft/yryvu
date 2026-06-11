// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Add-submodule dialog. Mirrors GK's `openSubmoduleSlideyPanel`
 * (audit doc 10): two required inputs (URL + target path) plus the
 * optional knobs (#98): tracking branch (recorded as
 * `submodule.<name>.branch` in .gitmodules) and custom name override.
 * Submit goes through `submoduleAdd` — libgit2 for the plain case,
 * `git submodule add` shell-out when branch / name are set.
 */
export function SubmoduleAddDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const canSubmit = () =>
    ops.dialogNameInput().trim().length > 0 &&
    ops.dialogPathInput().trim().length > 0;

  return (
    <Dialog
      open={ops.dialog()?.kind === "submodule-add"}
      title="Add submodule"
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
            onClick={() => void ops.submitSubmoduleAdd()}
          >
            Add
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="submodule-add-url">Repository URL</label>
        <input
          id="submodule-add-url"
          type="text"
          value={ops.dialogNameInput()}
          placeholder="https://github.com/user/repo.git"
          onInput={(e) => ops.setDialogNameInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit()) {
              void ops.submitSubmoduleAdd();
            }
          }}
        />
      </div>
      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="submodule-add-path">Target path</label>
        <input
          id="submodule-add-path"
          type="text"
          value={ops.dialogPathInput()}
          placeholder="vendor/my-lib"
          onInput={(e) => ops.setDialogPathInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit()) {
              void ops.submitSubmoduleAdd();
            }
          }}
        />
      </div>
      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="submodule-add-branch">Branch (optional)</label>
        <input
          id="submodule-add-branch"
          type="text"
          value={ops.submoduleBranch()}
          placeholder="main"
          onInput={(e) => ops.setSubmoduleBranch(e.currentTarget.value)}
        />
      </div>
      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="submodule-add-name">Name (optional)</label>
        <input
          id="submodule-add-name"
          type="text"
          value={ops.submoduleName()}
          placeholder="defaults to the target path"
          onInput={(e) => ops.setSubmoduleName(e.currentTarget.value)}
        />
      </div>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
