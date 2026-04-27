// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../Dialog";

/**
 * Confirmation modal for destructive toolbar actions (Force pull, Force
 * push). Wraps the shared `<Dialog>` so we get the focus trap + Escape
 * dismiss + portal behavior for free.
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Dialog
      open={props.open}
      title={props.title}
      onClose={props.onCancel}
      footer={
        <>
          <button
            type="button"
            class="dialog__btn"
            data-dismiss
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            classList={{
              "dialog__btn": true,
              "dialog__btn--danger": props.destructive ?? true,
              "dialog__btn--primary": !(props.destructive ?? true),
            }}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <Show when={props.body}>
        {(b) => <p class="dialog__warning">{b()}</p>}
      </Show>
    </Dialog>
  );
}
