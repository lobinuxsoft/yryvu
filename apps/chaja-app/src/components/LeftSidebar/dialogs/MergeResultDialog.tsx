// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import type { MergeResult } from "../../../ipc";
import { Dialog } from "../../Dialog";
import { mergeResultTitle } from "../helpers";
import type { BranchOps } from "../useBranchOps";

export function MergeResultDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const result = () =>
    ops.dialog()?.kind === "merge-result"
      ? (ops.dialog() as { result: MergeResult }).result
      : undefined;

  return (
    <Dialog
      open={ops.dialog()?.kind === "merge-result"}
      title={mergeResultTitle(result())}
      onClose={ops.closeDialog}
      footer={
        <Show
          when={result()?.kind === "conflict"}
          fallback={
            <button
              class="dialog__btn dialog__btn--primary"
              type="button"
              data-dismiss
              onClick={ops.closeDialog}
            >
              Close
            </button>
          }
        >
          <button
            class="dialog__btn dialog__btn--danger"
            type="button"
            onClick={() => void ops.doAbortMerge()}
          >
            Abort merge
          </button>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={ops.closeDialog}
          >
            Leave for manual resolve
          </button>
        </Show>
      }
    >
      <Show when={result()} fallback={null}>
        <ResultBody result={result()!} />
      </Show>
    </Dialog>
  );
}

function ResultBody(props: { result: MergeResult }) {
  if (props.result.kind === "already-up-to-date") {
    return <p>Already up to date. No changes applied.</p>;
  }
  if (props.result.kind === "fast-forward") {
    return (
      <p>
        Fast-forwarded HEAD to <code>{props.result.new_head.slice(0, 7)}</code>.
      </p>
    );
  }
  if (props.result.kind === "merged") {
    return (
      <p>
        Created merge commit <code>{props.result.new_head.slice(0, 7)}</code>.
      </p>
    );
  }
  return (
    <>
      <p>Merge produced conflicts in:</p>
      <ul
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "12px",
          margin: "6px 0 0 16px",
        }}
      >
        <For each={props.result.paths}>{(p) => <li>{p}</li>}</For>
      </ul>
      <p
        style={{
          color: "var(--fg-3)",
          "font-size": "12px",
          "margin-top": "8px",
        }}
      >
        The repo is in a merge-in-progress state. Resolve the files manually
        (editor + <code>git add</code> + <code>git commit</code>) — or wait
        for Chajá's conflict resolver (issue #10). Click{" "}
        <strong>Abort merge</strong> to discard the merge entirely (reset
        hard to HEAD).
      </p>
    </>
  );
}
