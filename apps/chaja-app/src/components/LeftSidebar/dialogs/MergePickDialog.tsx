// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import type { MergeStrategy } from "../../../ipc";
import { Dialog } from "../../Dialog";
import type { BranchOps } from "../useBranchOps";

const STRATEGIES: { value: MergeStrategy; label: string }[] = [
  {
    value: "fast-forward-or-merge",
    label: "Fast-forward if possible, otherwise merge commit",
  },
  { value: "fast-forward-only", label: "Fast-forward only (abort otherwise)" },
  {
    value: "no-fast-forward",
    label: "Always create a merge commit (no fast-forward)",
  },
];

export function MergePickDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const source = () =>
    ops.dialog()?.kind === "merge-pick"
      ? (ops.dialog() as { source: string }).source
      : "";

  return (
    <Dialog
      open={ops.dialog()?.kind === "merge-pick"}
      title={`Merge '${source()}' into current`}
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
            onClick={() => void ops.submitMerge()}
          >
            Merge
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label>Strategy</label>
        <div
          style={{ display: "flex", "flex-direction": "column", gap: "6px" }}
        >
          <For each={STRATEGIES}>
            {(s) => (
              <label
                style={{
                  display: "flex",
                  gap: "6px",
                  "align-items": "center",
                }}
              >
                <input
                  type="radio"
                  name="merge-strategy"
                  value={s.value}
                  checked={ops.mergeStrategy() === s.value}
                  onChange={() => ops.setMergeStrategy(s.value)}
                />
                <span>{s.label}</span>
              </label>
            )}
          </For>
        </div>
      </div>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
