// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";

/**
 * Confirmation dialog for tag deletion. The dialog state's `scope`
 * discriminator drives both the body copy and which backend op the
 * submitter dispatches — see `branchOps/handlers/tags.ts`.
 */
export function DeleteTagDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () => {
    const d = ops.dialog();
    return d?.kind === "delete-tag" ? d : null;
  };

  const title = () => {
    const s = state();
    if (!s) return "Delete tag";
    switch (s.scope.type) {
      case "local":
        return "Delete local tag";
      case "remote":
        return `Delete tag from ${s.scope.remote}`;
      case "all-remotes":
        return "Delete tag from all remotes";
    }
  };

  return (
    <Dialog
      open={ops.dialog()?.kind === "delete-tag"}
      title={title()}
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
            onClick={() => void ops.submitDeleteTag()}
          >
            Delete
          </button>
        </>
      }
    >
      <Show when={state()}>
        {(s) => (
          <Show
            when={s().scope.type !== "local"}
            fallback={
              <p>
                Delete the local tag <code>{s().name}</code>?
              </p>
            }
          >
            <Show
              when={s().scope.type === "remote"}
              fallback={
                <p>
                  Delete <code>{s().name}</code> from{" "}
                  <strong>{remoteCount(s())} remotes</strong>? The local
                  copy stays intact.
                </p>
              }
            >
              <p>
                Delete <code>{s().name}</code> from{" "}
                <strong>{remoteName(s())}</strong>? The local copy stays
                intact.
              </p>
            </Show>
          </Show>
        )}
      </Show>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}

function remoteName(
  s: { scope: { type: "remote"; remote: string } | object },
): string {
  return s.scope && "remote" in s.scope ? (s.scope.remote as string) : "";
}

function remoteCount(
  s: { scope: { type: "all-remotes"; remotes: string[] } | object },
): number {
  return s.scope && "remotes" in s.scope
    ? (s.scope.remotes as string[]).length
    : 0;
}
