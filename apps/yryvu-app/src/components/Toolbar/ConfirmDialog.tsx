// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show } from "solid-js";

import { Dialog } from "../Dialog";

/**
 * Confirmation modal for destructive toolbar actions (Force pull, Force
 * push). Wraps the shared `<Dialog>` so we get the focus trap + Escape
 * dismiss + portal behavior for free.
 *
 * Passing `onConfirm` a `dontAskAgain` flag is opt-in per call site via
 * `suppressible`. Only offer it where skipping the prompt cannot lose
 * work — GitKraken exposes it on exactly one git-destructive
 * confirmation (force push *with lease*, whose lease blocks a push
 * against a moved remote) and on nothing that discards or resets. A
 * checkbox here is a promise that the operation behind it is recoverable.
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  suppressible?: boolean;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const [dontAskAgain, setDontAskAgain] = createSignal(false);

  // Never pre-ticked, and cleared on both exits so a tick the user
  // abandoned by cancelling doesn't ride along into the next prompt.
  const confirm = () => {
    const suppress = props.suppressible === true && dontAskAgain();
    setDontAskAgain(false);
    props.onConfirm(suppress);
  };

  const cancel = () => {
    setDontAskAgain(false);
    props.onCancel();
  };

  return (
    <Dialog
      open={props.open}
      title={props.title}
      onClose={cancel}
      footer={
        <>
          <button
            type="button"
            class="dialog__btn"
            data-dismiss
            onClick={cancel}
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
            onClick={confirm}
          >
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <Show when={props.body}>
        {(b) => <p class="dialog__warning">{b()}</p>}
      </Show>
      <Show when={props.suppressible}>
        <label class="dialog__checkbox" style={{ "margin-top": "12px" }}>
          <input
            type="checkbox"
            checked={dontAskAgain()}
            onChange={(e) => setDontAskAgain(e.currentTarget.checked)}
          />
          <span>Don't ask again</span>
        </label>
      </Show>
    </Dialog>
  );
}
