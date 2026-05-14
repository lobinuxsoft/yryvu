// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";

export type ContextMenuItem =
  | {
      type?: "item";
      label: string;
      disabled?: boolean;
      danger?: boolean;
      /// Native tooltip surfaced via the button's `title` attribute.
      /// Use it to explain WHY a disabled item is disabled (e.g. a
      /// blocking issue link), not to duplicate the label.
      title?: string;
      onSelect: () => void;
    }
  | { type: "separator" };

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu(props: ContextMenuProps) {
  let menuRef: HTMLDivElement | undefined;
  const [position, setPosition] = createSignal({ x: props.x, y: props.y });
  const [activeIndex, setActiveIndex] = createSignal(-1);

  /**
   * Clamp a (x, y) anchor inside the viewport using the menu's measured
   * size. With CSS `max-height: calc(100vh - 16px)` plus this clamp, a
   * menu can never spill outside the viewport: tall menus get an
   * inner scroll, wide menus hug the right edge, and anchors near the
   * bottom-right corner reflow up-and-left to fit.
   */
  function clampToViewport(x: number, y: number): { x: number; y: number } {
    if (!menuRef) return { x, y };
    const rect = menuRef.getBoundingClientRect();
    const margin = 8;
    let nx = x;
    let ny = y;
    if (nx + rect.width > window.innerWidth - margin) {
      nx = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (ny + rect.height > window.innerHeight - margin) {
      ny = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    return { x: nx, y: ny };
  }

  // Initial clamp once the DOM is connected (we need a real rect to
  // measure). Re-clamp on prop changes happens in the createEffect
  // below — without it, the previous version restored raw click coords
  // every time props updated, dropping the clamp the user expected.
  onMount(() => {
    setPosition(clampToViewport(props.x, props.y));
  });

  const onDocPointerDown = (e: PointerEvent) => {
    if (!menuRef) return;
    if (!menuRef.contains(e.target as Node)) props.onClose();
  };
  const onDocKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      stepActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      stepActive(-1);
    } else if (e.key === "Enter") {
      const idx = activeIndex();
      const item = props.items[idx];
      if (item && item.type !== "separator" && !item.disabled) {
        item.onSelect();
        props.onClose();
      }
    }
  };

  function firstSelectable(from: number, step: 1 | -1): number {
    const n = props.items.length;
    if (n === 0) return -1;
    let i = from;
    for (let k = 0; k < n; k++) {
      const item = props.items[i];
      if (item && item.type !== "separator" && !item.disabled) return i;
      i = (i + step + n) % n;
    }
    return -1;
  }
  function stepActive(step: 1 | -1) {
    const cur = activeIndex();
    const start = cur === -1 ? (step > 0 ? 0 : props.items.length - 1) : (cur + step + props.items.length) % props.items.length;
    const next = firstSelectable(start, step);
    setActiveIndex(next);
  }

  onMount(() => {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeyDown, true);
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeyDown, true);
  });

  // Re-clamp when the parent feeds new (x, y) without unmounting. Skipped
  // on the very first run because `menuRef` isn't connected yet — onMount
  // covers that path.
  createEffect(() => {
    if (menuRef) {
      setPosition(clampToViewport(props.x, props.y));
    }
  });

  return (
    <Portal>
      <div
        ref={menuRef}
        class="ctx-menu"
        role="menu"
        style={{ left: `${position().x}px`, top: `${position().y}px` }}
      >
        <For each={props.items}>
          {(item, index) => (
            <Show
              when={item.type !== "separator"}
              fallback={<div class="ctx-menu__separator" role="separator" />}
            >
              <button
                class="ctx-menu__item"
                type="button"
                role="menuitem"
                data-active={activeIndex() === index() ? "true" : "false"}
                data-danger={"danger" in item && item.danger ? "true" : "false"}
                disabled={"disabled" in item ? item.disabled : false}
                title={"title" in item ? item.title : undefined}
                onMouseEnter={() => setActiveIndex(index())}
                onClick={() => {
                  if (item.type === "separator" || item.disabled) return;
                  item.onSelect();
                  props.onClose();
                }}
              >
                {"label" in item ? item.label : ""}
              </button>
            </Show>
          )}
        </For>
      </div>
    </Portal>
  );
}
