// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tab strip — the right-hand cluster of pills + + + chevron. The leading
 * (open-repo / favorites) cluster is owned by AppShell and stays
 * unchanged; this component is only the strip itself.
 *
 * Layout (cited bundle:330605-330614, audit doc 03):
 *
 *     [REPO_MGMT][tab1][tab2][tab3][ + ][ ⌄ ]
 *     └ permanent┘└ transient strip ┘
 *
 * Permanent pills render LEFT of transient. The dropdown chevron is
 * a stub until #206 wires the menu — visible-but-disabled.
 */

import { createSignal, For, onCleanup, Show } from "solid-js";

import { Tooltip } from "../Tooltip";
import {
  isTabDropdownOpen,
  selectedTabId,
  tabs,
  toggleTabDropdown,
} from "../../tabs/state";
import { openNewTab } from "../../tabs/ops";
import { performTabOperation } from "../../tabs/dispatcher";
import { NEW_TAB_BUTTON_ID } from "../../tabs/types";
import { computeTargetIndex, DRAG_THRESHOLD_PX } from "./dragMath";
import { TabDropdown } from "./TabDropdown";
import { TabPill } from "./TabPill";
import { Icon } from "../Icon";

/// Live drag state. `dragging: false` until the cursor moves past the
/// click/drag threshold — clicks shouldn't be misinterpreted as drags.
interface DragState {
  index: number;
  startX: number;
  pillRects: { left: number; right: number; width: number }[];
  delta: number;
  targetIndex: number;
  dragging: boolean;
}

export function TabBar() {
  let stripEl: HTMLDivElement | undefined;
  let chevronEl: HTMLButtonElement | undefined;
  const [anchor, setAnchor] = createSignal<{ top: number; left: number } | null>(
    null,
  );
  const [drag, setDrag] = createSignal<DragState | null>(null);

  const onSelect = (id: string) =>
    void performTabOperation({ type: "SWITCH_TO", tabId: id });

  const onChevronClick = () => {
    if (chevronEl) {
      const rect = chevronEl.getBoundingClientRect();
      // Align the popover's right edge to the chevron's right edge so
      // it doesn't overflow the viewport on narrow windows. The
      // popover is 320 px wide (see tabs.css `.tab-dropdown`).
      const POPOVER_WIDTH = 320;
      setAnchor({
        top: rect.bottom,
        left: Math.max(8, rect.right - POPOVER_WIDTH),
      });
    }
    toggleTabDropdown();
  };

  const onClose = (id: string) =>
    void performTabOperation({ type: "CLOSE", tabId: id });

  /// Pointer-down on a transient pill. Captures bounding rects of every
  /// transient pill in the strip — the pillRects array is what feeds
  /// computeTargetIndex during pointermove. Permanent pills are excluded
  /// (they don't reorder).
  const onPillPointerDown = (index: number, e: PointerEvent) => {
    if (e.button !== 0 || !stripEl) return;
    const pillEls = stripEl.querySelectorAll<HTMLElement>(
      ".tab[data-transient='true']",
    );
    const pillRects = Array.from(pillEls).map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    });
    setDrag({
      index,
      startX: e.clientX,
      pillRects,
      delta: 0,
      targetIndex: index,
      dragging: false,
    });
    // Window listeners — the dragged pill might leave the pill's own
    // hitbox so we capture at the document level.
    document.addEventListener("pointermove", onWindowPointerMove);
    document.addEventListener("pointerup", onWindowPointerUp);
  };

  const onWindowPointerMove = (e: PointerEvent) => {
    const d = drag();
    if (!d) return;
    const delta = e.clientX - d.startX;
    const dragging = d.dragging || Math.abs(delta) >= DRAG_THRESHOLD_PX;
    const targetIndex = dragging
      ? computeTargetIndex(e.clientX, d.pillRects, d.index)
      : d.index;
    setDrag({ ...d, delta, dragging, targetIndex });
  };

  const onWindowPointerUp = () => {
    const d = drag();
    if (!d) return;
    document.removeEventListener("pointermove", onWindowPointerMove);
    document.removeEventListener("pointerup", onWindowPointerUp);
    if (d.dragging && d.targetIndex !== d.index) {
      void performTabOperation({
        type: "MOVE",
        oldIndex: d.index,
        newIndex: d.targetIndex,
      });
    }
    setDrag(null);
  };

  // Defensive cleanup if the component unmounts mid-drag (e.g. window
  // close during a drag would leak the document listeners).
  onCleanup(() => {
    document.removeEventListener("pointermove", onWindowPointerMove);
    document.removeEventListener("pointerup", onWindowPointerUp);
  });

  /// Slot offset for non-dragged pills so they slide out of the way of
  /// the dragged pill. Positive = slides right, negative = slides left.
  const slotOffset = (i: number): number => {
    const d = drag();
    if (!d || !d.dragging) return 0;
    const dragged = d.index;
    const target = d.targetIndex;
    if (i === dragged) return 0;
    const draggedWidth = d.pillRects[dragged]?.width ?? 0;
    if (target > dragged && i > dragged && i <= target) return -draggedWidth;
    if (target < dragged && i < dragged && i >= target) return draggedWidth;
    return 0;
  };

  /// Whether a pill index is the one currently being dragged.
  const isDragged = (i: number): boolean => {
    const d = drag();
    return !!d && d.dragging && d.index === i;
  };

  return (
    <div
      ref={stripEl}
      class="tabs__strip"
      classList={{ "is-dragging": !!drag()?.dragging }}
      role="tablist"
    >
      {/* REPO_MANAGEMENT renders as an icon button in the tab leading
          area (AppShell), NOT as a pill in the strip — matches GK
          (bundle:330440-330465 makeTabIcon, NOT a pill). The
          `permanentTabs.repoManagement` state slot is initialized with
          `{}` per bundle:2089; there is no `closed` flag for it. */}

      <For each={tabs()}>
        {(tab, i) => (
          <TabPill
            tab={tab}
            isActive={selectedTabId() === tab.id}
            onSelect={onSelect}
            onClose={onClose}
            onPointerDown={(e) => onPillPointerDown(i(), e)}
            translateX={
              isDragged(i()) ? drag()!.delta : slotOffset(i())
            }
            isBeingDragged={isDragged(i())}
          />
        )}
      </For>

      <Tooltip text="New tab (Ctrl+T)">
        <button
          id={NEW_TAB_BUTTON_ID}
          class="tabs__new"
          type="button"
          aria-label="New tab"
          onClick={() => void openNewTab()}
        >
          <Icon name="plus" />
        </button>
      </Tooltip>

      <Tooltip text="Tab menu">
        <button
          ref={chevronEl}
          class="tabs__dropdown"
          type="button"
          aria-label="Tab menu"
          aria-expanded={isTabDropdownOpen()}
          onClick={onChevronClick}
        >
          <Icon name="chevron-down" />
        </button>
      </Tooltip>

      <Show when={isTabDropdownOpen() && anchor()}>
        <TabDropdown anchor={anchor()!} />
      </Show>
    </div>
  );
}
