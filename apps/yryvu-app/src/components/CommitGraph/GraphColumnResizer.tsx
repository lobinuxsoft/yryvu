// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Drag-handle stripe rendered between two adjacent graph columns.
 * Visually sits on the LEFT edge of the right column (and the RIGHT
 * edge of the left column — same boundary). Drag behaves like a window
 * border between two adjacent panes: cursor moves right, left column
 * grows, right column shrinks, handle follows the cursor. Only the
 * two adjacent zones change; the rest of the row stays put.
 *
 * Implementation: capture pointer on `pointerdown`, switch the cursor
 * + body class for the duration of the drag, write the new widths on
 * every `pointermove` through `setGraphZonePairInteractive`.
 * `setPointerCapture` keeps events flowing even when the cursor strays
 * outside the handle (matches the expected resize-handle UX from
 * GTK / VS Code).
 */

import {
  activeColumnSettings,
  commitGraphColumnLayout,
  setGraphZonePairInteractive,
} from "../../state";
import type { GraphZoneId } from "./columns";

const DRAG_BODY_CLASS = "is-resizing-column";

export function GraphColumnResizer(props: {
  leftZone: GraphZoneId;
  rightZone: GraphZoneId;
}) {
  let startX = 0;
  let startLeftWidth = 0;
  let startRightWidth = 0;
  let dirty = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startLeftWidth = activeColumnSettings(props.leftZone).width;
    startRightWidth = activeColumnSettings(props.rightZone).width;
    dirty = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.classList.add(DRAG_BODY_CLASS);
  };

  const onPointerMove = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    if (!target.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startX;
    // Window-border semantics: cursor right → left zone grows, right
    // zone shrinks by the same amount. The pair function clamps both
    // sides to their min widths and conserves the total so the handle
    // stops at the floor instead of overshooting.
    setGraphZonePairInteractive(
      props.leftZone,
      startLeftWidth + dx,
      props.rightZone,
      startRightWidth - dx,
    );
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
