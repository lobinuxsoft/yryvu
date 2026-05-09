// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Set / clear the upstream tracking config for a local branch. Mirrors
 * GK's `promptSetUpstreamForRef` (bundle:232427): a single text input
 * pre-seeded with the current upstream. Submitting an empty string
 * clears the tracking config (`git branch --unset-upstream`).
 */
export function SetUpstreamDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () => {
    const d = ops.dialog();
    return d?.kind === "set-upstream" ? d : null;
  };

  return (
    <Dialog
      open={ops.dialog()?.kind === "set-upstream"}
      title={`Set upstream for '${state()?.branchName ?? ""}'`}
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
            onClick={() => void ops.submitSetUpstream()}
          >
            {ops.dialogNameInput().trim() ? "Save" : "Clear upstream"}
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="set-upstream-ref">Upstream ref</label>
        <input
          id="set-upstream-ref"
          type="text"
          value={ops.dialogNameInput()}
          placeholder="origin/main"
          onInput={(e) => ops.setDialogNameInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ops.submitSetUpstream();
          }}
        />
      </div>
      <p
        style={{
          "margin-top": "8px",
          color: "var(--fg-2)",
          "font-size": "12px",
        }}
      >
        Format: <code>&lt;remote&gt;/&lt;branch&gt;</code> (e.g.{" "}
        <code>origin/main</code>). Leave empty to clear the upstream.
      </p>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
