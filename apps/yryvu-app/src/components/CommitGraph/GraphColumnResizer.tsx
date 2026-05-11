// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Drag-handle stripe rendered between two adjacent graph columns.
 *
 * 1:1 with GitKraken's `resize-handle` (bundle confirms `enableResizer`
 * + `resize-handle` class). The resizer drives the column on its LEFT
 * — dragging right grows the left column and shrinks whatever lives on
 * the right side of the layout. Width is clamped to the zone's
 * `[min, max]` from `ZONE_SPECS`.
 *
 * Implementation: capture pointer on `pointerdown`, switch the cursor
 * + body class for the duration of the drag, write the new width on
 * every `pointermove`. `setPointerCapture` keeps events flowing even
 * if the cursor strays outside the handle (matches the expected
 * resize-handle UX from GTK / VS Code).
 */

import {
  activeColumnSettings,
  commitGraphColumnLayout,
  setGraphZoneWidthInteractive,
} from "../../state";
import type { GraphZoneId } from "./columns";

const DRAG_BODY_CLASS = "is-resizing-column";

export function GraphColumnResizer(props: { leftZone: GraphZoneId }) {
  let startX = 0;
  let startWidth = 0;
  let dirty = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startWidth = activeColumnSettings(props.leftZone).width;
    dirty = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.classList.add(DRAG_BODY_CLASS);
  };

  const onPointerMove = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    if (!target.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startX;
    // Ephemeral update only — running the cascade math + signal write per
    // frame is fine (Solid handles it), but localStorage I/O is not.
    // Persistence happens once on pointerup below.
    setGraphZoneWidthInteractive(props.leftZone, startWidth + dx);
    dirty = true;
  };

  const onPointerUp = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    document.body.classList.remove(DRAG_BODY_CLASS);
    if (dirty) {
      commitGraphColumnLayout();
      dirty = false;
    }
  };

  return (
    <span
      class="graph-column-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
