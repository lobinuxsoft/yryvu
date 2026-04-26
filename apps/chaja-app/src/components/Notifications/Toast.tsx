// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, For, onCleanup, onMount, Show } from "solid-js";

import {
  IconAlertCircle,
  IconCheck,
  IconClose,
  IconInfo,
  IconSpinner,
} from "../Icons";
import { dismissToast, durationMs } from "./store";
import type { NotificationItem, Severity } from "./types";

function severityIcon(severity: Severity) {
  switch (severity) {
    case "info":
      return <IconInfo />;
    case "success":
      return <IconCheck />;
    case "error":
      return <IconAlertCircle />;
    case "loading":
      return <IconSpinner class="toast__spinner" />;
  }
}

interface ToastProps {
  item: NotificationItem;
}

export function Toast(props: ToastProps) {
  let timer: number | undefined;
  let remaining = createMemo(() => durationMs(props.item.duration));

  function arm() {
    if (timer !== undefined) window.clearTimeout(timer);
    const ms = remaining();
    if (!isFinite(ms)) return;
    timer = window.setTimeout(() => dismissToast(props.item.id), ms);
  }

  onMount(() => arm());
  onCleanup(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });

  function onPause() {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  }
  function onResume() {
    if (isFinite(remaining())) arm();
  }

  function onBodyClick() {
    if (props.item.dismissable === "default") dismissToast(props.item.id);
  }

  return (
    <div
      class="toast"
      classList={{
        [`toast--${props.item.severity}`]: true,
        "toast--clickable": props.item.dismissable === "default",
      }}
      role="status"
      aria-live={props.item.severity === "error" ? "assertive" : "polite"}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
    >
      <span class="toast__icon">{severityIcon(props.item.severity)}</span>
      <div class="toast__body" onClick={onBodyClick}>
        <div class="toast__title">{props.item.title}</div>
        <Show when={props.item.message}>
          {(msg) => <div class="toast__message">{msg()}</div>}
        </Show>
        <Show when={props.item.actions.length > 0}>
          <div class="toast__actions">
            <For each={props.item.actions}>
              {(action) => (
                <button
                  class="toast__action"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    try {
                      action.onClick();
                    } catch (err) {
                      // chajá addition: GK's ErrorBoundary protects content
                      // and buttons but NOT the onClick callback itself
                      // (`/tmp/gk-bundle-pretty.js`). Logging keeps a runaway
                      // action from killing the toast container.
                      console.error("toast action threw:", err);
                    }
                    dismissToast(props.item.id);
                  }}
                >
                  {action.label}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <button
        class="toast__close"
        type="button"
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation();
          dismissToast(props.item.id);
        }}
      >
        <IconClose width="12" height="12" />
      </button>
    </div>
  );
}
