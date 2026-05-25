// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Resizable shell for the right-side inspector (issue #134, PR1).
 *
 * Renders a single drag handle on the left edge. Pointer events live
 * at the document level so a fast drag that leaves the handle's
 * hitbox doesn't drop tracking; the listeners detach on pointer-up.
 * Width signal updates fire with `persist=false` during the drag and
 * a single `commit` runs on pointer-up to round-trip one IPC write
 * per drag gesture instead of one per pixel.
 *
 * Height drag is deferred — PR1.5 will add a top-edge handle once
 * the shell grid is refactored to bottom-anchor the inspector (the
 * current `auto 1fr auto` grid spans the full row, so vertical drag
 * has no semantic target). Audit doc `01-panel-chrome.md`.
 */

import { type JSX, onCleanup } from "solid-js";

import {
  clampWidth,
  commitDetailPanelLayout,
  detailPanelWidth,
  setDetailPanelWidth,
} from "../../state/detail-panel-layout";

interface Props {
  children: JSX.Element;
}

/// GK uses `window.innerWidth - 651` as the "everything left of the
/// inspector" reservation (title bar + toolbar + graph + left panel).
/// The actual pixel offset depends on the user's layout; reading
/// `clientWidth` of the shell main area at drag-start is more accurate
/// than baking a constant, but we still cap above the floor to handle
/// pathological viewport shrinks gracefully.
function viewportMaxWidth(): number {
  const innerWidth =
    typeof window !== "undefined" ? window.innerWidth : 1280;
  // Reserve at least 480px for the main viewport (graph readable).
  return Math.max(0, innerWidth - 480);
}

export function ResizableInspector(props: Props) {
  let dragStartX = 0;
  let dragStartWidth = 0;

  const onPointerMove = (e: PointerEvent) => {
    // GK semantics: dragging the LEFT edge to the LEFT enlarges the
    // panel (it grows leftward). delta < 0 means the cursor moved
    // left, so we subtract delta to grow.
    const delta = e.clientX - dragStartX;
    const next = clampWidth(dragStartWidth - delta, viewportMaxWidth());
    setDetailPanelWidth(next, false);
  };

  const onPointerUp = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    commitDetailPanelLayout();
  };

  const onHandlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStartX = e.clientX;
    dragStartWidth = detailPanelWidth();
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  };

  onCleanup(() => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  });

  return (
    <div class="inspector-resizable">
      <div
        class="inspector-resizable__handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector panel"
        onPointerDown={onHandlePointerDown}
      />
      {props.children}
    </div>
  );
}
