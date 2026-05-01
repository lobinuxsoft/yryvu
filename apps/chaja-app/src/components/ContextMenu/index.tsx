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

  // Flip inside viewport after mount (measure real size, then reposition).
  onMount(() => {
    if (!menuRef) return;
    const rect = menuRef.getBoundingClientRect();
    let nx = props.x;
    let ny = props.y;
    if (nx + rect.width > window.innerWidth - 8) {
      nx = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (ny + rect.height > window.innerHeight - 8) {
      ny = Math.max(8, window.innerHeight - rect.height - 8);
    }
    setPosition({ x: nx, y: ny });
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

  createEffect(() => {
    setPosition({ x: props.x, y: props.y });
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
