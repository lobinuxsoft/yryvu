// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Convert a lightweight tag into an annotated one — collects the
 * annotation message body. Reuses `dialogNameInput` as the message
 * field so the existing input plumbing picks it up without a second
 * signal slot. The submit-button stays disabled until the field has
 * content; the backend rejects empty messages too as a defensive
 * second check.
 */
export function AnnotateTagDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const tagName = () => {
    const d = ops.dialog();
    return d?.kind === "annotate-tag" ? d.name : undefined;
  };

  return (
    <Dialog
      open={ops.dialog()?.kind === "annotate-tag"}
      title="Annotate tag"
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
            disabled={!ops.dialogNameInput().trim()}
            onClick={ops.submitAnnotateTag}
          >
            Annotate
          </button>
        </>
      }
    >
      <p>
        Convert <code>{tagName()}</code> into an annotated tag with the
        message below.
      </p>
      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="annotate-tag-message">Message</label>
        <textarea
          id="annotate-tag-message"
          rows={4}
          value={ops.dialogNameInput()}
          placeholder="What does this release / milestone mark?"
          onInput={(e) => ops.setDialogNameInput(e.currentTarget.value)}
        />
      </div>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
