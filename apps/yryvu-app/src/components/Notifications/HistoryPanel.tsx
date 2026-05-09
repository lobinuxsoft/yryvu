// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";

import {
  IconAlertCircle,
  IconCheck,
  IconClose,
  IconInfo,
  IconSpinner,
} from "../Icons";
import {
  clearHistory,
  history,
  markAllRead,
  removeHistoryEntry,
} from "./store";
import type { Severity } from "./types";

function severityGlyph(severity: Severity) {
  switch (severity) {
    case "info":
      return <IconInfo width="12" height="12" />;
    case "success":
      return <IconCheck width="12" height="12" />;
    case "error":
      return <IconAlertCircle width="12" height="12" />;
    case "loading":
      return <IconSpinner width="12" height="12" />;
  }
}

function relativeTime(now: number, ts: number): string {
  const ms = now - ts;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

interface HistoryPanelProps {
  onClose: () => void;
}

export function HistoryPanel(props: HistoryPanelProps) {
  let panelEl: HTMLDivElement | undefined;
  const [now, setNow] = createSignal(Date.now());

  onMount(() => {
    // Re-render relative timestamps every 30s so "5s ago" doesn't lie.
    const intervalId = window.setInterval(() => setNow(Date.now()), 30000);

    const onDocPointer = (e: MouseEvent) => {
      if (panelEl && !panelEl.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);

    // Mark everything as read the instant the panel opens — matches GK's
    // bell-icon UX (badge clears as soon as you peek).
    markAllRead();

    onCleanup(() => {
      window.clearInterval(intervalId);
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    });
  });

  const items = createMemo(() => history());

  return (
    <div class="notif-history" ref={panelEl} role="dialog" aria-label="Notifications history">
      <div class="notif-history__header">
        <span class="notif-history__title">Notifications</span>
        <button
          class="notif-history__clear"
          type="button"
          disabled={items().length === 0}
          onClick={clearHistory}
        >
          Clear all
        </button>
      </div>
      <Show
        when={items().length > 0}
        fallback={
          <div class="notif-history__empty">No notifications yet.</div>
        }
      >
        <ul class="notif-history__list">
          <For each={items()}>
            {(item) => (
              <li class={`notif-history__item notif-history__item--${item.severity}`}>
                <span class="notif-history__icon">{severityGlyph(item.severity)}</span>
                <div class="notif-history__body">
                  <div class="notif-history__row">
                    <span class="notif-history__entry-title">{item.title}</span>
                    <span class="notif-history__time">
                      {relativeTime(now(), item.createdAt)}
                    </span>
                  </div>
                  <Show when={item.message}>
                    {(msg) => <div class="notif-history__message">{msg()}</div>}
                  </Show>
                </div>
                <button
                  class="notif-history__remove"
                  type="button"
                  aria-label="Remove from history"
                  onClick={() => removeHistoryEntry(item.id)}
                >
                  <IconClose width="10" height="10" />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
