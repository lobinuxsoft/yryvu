// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Single tab pill — renders a transient tab from the store. Click body
 * switches, hover surfaces the × close button, click × closes (audit
 * doc 03).
 *
 * Drag-reorder (#39): the pointer-down handler routes through the
 * parent (TabBar), which manages the drag state across all pills. This
 * pill renders a `transform: translateX(...)` for either the dragged
 * pill (delta from cursor) or the slot it's currently displaced into.
 *
 * The native `title` attr supplies the tooltip on truncated labels.
 * Audit doc 03 specifies a 600ms hover delay + 250px max width — that's
 * a custom tooltip surface we'll port when a future cluster needs it
 * (skeleton already in tabs.css). For v1 the OS-native tooltip suffices.
 */

import { Show } from "solid-js";

import { NfIcon } from "../NfIcon";
import { type Tab } from "../../tabs/types";
import { titleOf } from "./tabTitle";

interface Props {
  tab: Tab;
  isActive: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /// Parent wires pointer-down through to manage cross-pill drag state.
  /// The pill itself doesn't track drag — it just relays the event.
  onPointerDown: (e: PointerEvent) => void;
  /// Pixels to translate the pill horizontally. Non-zero only during
  /// an active drag — the dragged pill follows the cursor delta, sibling
  /// pills slide into the slot the dragged one is leaving / approaching.
  translateX: number;
  /// True for the pill the user has grabbed. Lifts z-index + blocks
  /// the click event that pointerup would otherwise generate.
  isBeingDragged: boolean;
}

export function TabPill(props: Props) {
  const title = () => titleOf(props.tab);
  // Suppress the click handler that fires after a drag releases — the
  // browser still emits a click event after pointerup if the pointer
  // moved beyond the threshold. Tracked locally per pill since the
  // click event doesn't include the drag-source pill index.
  let suppressClick = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      // Middle-click → close. Don't enter drag flow.
      if (e.button === 1) {
        e.preventDefault();
        props.onClose(props.tab.id);
      }
      return;
    }
    suppressClick = false;
    props.onPointerDown(e);
  };

  const onClickPill = (e: MouseEvent) => {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
      return;
    }
    if (e.button !== 0) return;
    props.onSelect(props.tab.id);
  };

  const onClickClose = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    props.onClose(props.tab.id);
  };

  // Watch the drag flag to set suppressClick at the right moment: when
  // the parent flips it from true → false, that's the pointerup. The
  // click event fires immediately after, which is the one to suppress.
  let wasDragging = false;
  const observeDrag = () => {
    if (wasDragging && !props.isBeingDragged) {
      suppressClick = true;
      // Reset on the next tick so a true click (no prior drag) isn't
      // accidentally suppressed.
      queueMicrotask(() => {
        suppressClick = false;
      });
    }
    wasDragging = props.isBeingDragged;
    return null;
  };

  return (
    <div
      class="tab"
      data-transient="true"
      classList={{
        "is-active": props.isActive,
        "is-being-dragged": props.isBeingDragged,
      }}
      role="tab"
      aria-selected={props.isActive}
      title={title()}
      style={{
        transform:
          props.translateX !== 0
            ? `translateX(${props.translateX}px)`
            : undefined,
      }}
      onPointerDown={onPointerDown}
      onClick={onClickPill}
    >
      {observeDrag()}
      <span class="tab__title">{title()}</span>
      <Show when={props.tab.type !== "NEW" || props.isActive}>
        <button
          class="tab__close"
          type="button"
          aria-label={`Close ${title()}`}
          title="Close tab"
          onClick={onClickClose}
        >
          <NfIcon code="f00d" />
        </button>
      </Show>
    </div>
  );
}
