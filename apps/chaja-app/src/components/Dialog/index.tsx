// SPDX-License-Identifier: AGPL-3.0-or-later

import { type JSX, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** If true, clicking the backdrop dismisses the dialog. Default: true. */
  dismissOnBackdrop?: boolean;
  children: JSX.Element;
  footer?: JSX.Element;
}

export function Dialog(props: DialogProps) {
  let bodyRef: HTMLDivElement | undefined;
  let lastFocus: HTMLElement | null = null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "Tab" && bodyRef) {
      // Focus trap.
      const focusable = bodyRef.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  onMount(() => {
    lastFocus = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", onKeyDown, true);
    queueMicrotask(() => {
      const target = bodyRef?.querySelector<HTMLElement>(
        "input, textarea, select, button:not([data-dismiss])",
      );
      target?.focus();
    });
  });
  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown, true);
    lastFocus?.focus?.();
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="dialog__backdrop"
          onMouseDown={(e) => {
            if (props.dismissOnBackdrop === false) return;
            if (e.target === e.currentTarget) props.onClose();
          }}
        >
          <div
            ref={bodyRef}
            class="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={props.title}
          >
            <header class="dialog__header">
              <h2 class="dialog__title">{props.title}</h2>
              <button
                class="dialog__close"
                type="button"
                data-dismiss
                aria-label="Close"
                onClick={() => props.onClose()}
              >
                ×
              </button>
            </header>
            <div class="dialog__body">{props.children}</div>
            <Show when={props.footer}>
              <footer class="dialog__footer">{props.footer}</footer>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
