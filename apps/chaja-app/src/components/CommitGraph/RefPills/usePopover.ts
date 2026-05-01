// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createSignal, onCleanup } from "solid-js";

/**
 * Hover-delayed popover state machine — matches GitKraken's
 * OverlayTrigger 250 ms hover behaviour. Open on pointer-enter of the
 * `+N` chip after the delay; cancel if the pointer leaves before it
 * elapses; keep open as long as the pointer stays in the chip OR the
 * popover (uses a small grace timer on leave so the user can move
 * diagonally between the two).
 *
 * Position is captured from the trigger's `getBoundingClientRect()` at
 * open time — the popover renders in a Portal so it can escape the
 * BRANCH/TAG zone's `overflow: hidden`.
 */
const HOVER_OPEN_DELAY = 250;
const HOVER_CLOSE_DELAY = 120;

export function usePopover() {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal<{ top: number; left: number } | null>(null);
  let triggerEl: HTMLButtonElement | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function setTrigger(el: HTMLButtonElement | undefined) {
    triggerEl = el;
  }

  function show() {
    if (triggerEl) {
      const rect = triggerEl.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(true);
  }

  function cancelTimers() {
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = undefined;
    }
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  }

  function scheduleOpen() {
    cancelTimers();
    openTimer = setTimeout(show, HOVER_OPEN_DELAY);
  }

  function scheduleClose() {
    cancelTimers();
    closeTimer = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY);
  }

  function keepOpen() {
    cancelTimers();
  }

  function toggle() {
    cancelTimers();
    if (open()) {
      setOpen(false);
    } else {
      show();
    }
  }

  onCleanup(cancelTimers);

  // Close on Escape — preserves keyboard escape hatch for hover popovers.
  createEffect(() => {
    if (!open()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  return {
    open,
    pos,
    setTrigger,
    scheduleOpen,
    scheduleClose,
    keepOpen,
    toggle,
  };
}
