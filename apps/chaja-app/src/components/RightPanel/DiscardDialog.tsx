// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../Dialog";

export interface DiscardDialogProps {
  paths: string[] | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/// Destructive confirmation before `discard_paths` fires. Matches the
/// app's Dialog portal pattern (see LeftSidebar/dialogs/DeleteDialog for
/// the reference shape) instead of WebKit2GTK's native `window.confirm`,
/// which the Tauri runtime stubs as auto-accept — that's how discard
/// fired without a prompt before this landed.
export function DiscardDialog(props: DiscardDialogProps) {
  const open = () => props.paths !== null && props.paths.length > 0;
  const paths = () => props.paths ?? [];
  const count = () => paths().length;

  return (
    <Dialog
      open={open()}
      title={count() === 1 ? "Discard file changes?" : "Discard changes to files?"}
      onClose={() => props.onCancel()}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={() => props.onCancel()}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--danger"
            type="button"
            onClick={() => props.onConfirm()}
          >
            Discard
          </button>
        </>
      }
    >
      <Show
        when={count() === 1}
        fallback={
          <>
            <p>
              Discard uncommitted changes to <strong>{count()}</strong> files?
            </p>
            <ul class="dialog__path-list">
              {paths().map((p) => (
                <li>
                  <code>{p}</code>
                </li>
              ))}
            </ul>
          </>
        }
      >
        <p>
          Discard uncommitted changes to <code>{paths()[0]}</code>?
        </p>
      </Show>
      <p class="dialog__warning">
        This reverts tracked files to HEAD and deletes untracked ones. The
        change cannot be undone.
      </p>
    </Dialog>
  );
}
