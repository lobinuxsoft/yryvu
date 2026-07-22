// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reusable single-edge resize handle (issues #134 + #36 + #151). Renders
 * a thin drag stripe on the panel's specified edge; pointer events live
 * at the document level so a fast drag that leaves the handle's hitbox
 * doesn't drop tracking. The drag stream calls `setSize(..., false)`
 * per pointermove (ephemeral) and `commit()` once on pointerup so the
 * persist round-trip happens once per drag gesture.
 *
 * The handle always grows the panel when the cursor moves *away* from
 * the panel's body:
 *   - `left`  — cursor LEFT grows it (right inspector's left edge).
 *   - `right` — cursor RIGHT grows it (left sidebar's right edge).
 *   - `top`   — cursor UP grows it (the commit region's top edge, which
 *     GK drives the same way: `<Resizable resizeEdge="top">`).
 *
 * `top` is the only Y-axis edge, so `size` means height there and width
 * on the other two; the component only ever deals in one scalar.
 */

import { type Accessor, onCleanup } from "solid-js";

type Edge = "left" | "right" | "top";

interface Props {
  /// Which edge of the panel the handle sits on.
  edge: Edge;
  /// Reactive size accessor (width for `left`/`right`, height for
  /// `top`) — read at drag-start to anchor the gesture.
  size: Accessor<number>;
  /// Apply a new size to the panel. `persist=false` during drag,
  /// the wrapper fires `commit()` once on pointerup.
  setSize: (next: number, persist?: boolean) => void;
  /// Clamp a candidate size against the panel's [min, max] for the
  /// current viewport. Callers compute `max` from the space they need
  /// to keep visible.
  clamp: (size: number, maxSize: number) => number;
  /// Container-derived upper bound recomputed per-frame. The handle
  /// passes this to `clamp` so a viewport shrink mid-drag pins the
  /// panel at its current ceiling instead of overflowing.
  viewportMaxSize: () => number;
  /// Force-persist the live size. Fires once on pointerup so we
  /// round-trip one IPC write per drag gesture instead of one per
  /// pixel.
  commit: () => void;
  /// Accessible label surfaced as `aria-label` on the handle.
  ariaLabel: string;
}

export function ResizableEdge(props: Props) {
  let dragStart = 0;
  let dragStartSize = 0;

  /// Sign that converts "cursor moved this far along the axis" into
  /// "the panel grew this much". `right` is the only edge on the same
  /// side as the growth direction.
  const growth = (): number => (props.edge === "right" ? 1 : -1);

  const axisPos = (e: PointerEvent): number =>
    props.edge === "top" ? e.clientY : e.clientX;

  const onPointerMove = (e: PointerEvent) => {
    const next = dragStartSize + growth() * (axisPos(e) - dragStart);
    props.setSize(props.clamp(next, props.viewportMaxSize()), false);
  };

  const onPointerUp = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    props.commit();
  };

  const onHandlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStart = axisPos(e);
    dragStartSize = props.size();
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  };

  onCleanup(() => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  });

  return (
    <div
      class="resizable-edge"
      classList={{
        "resizable-edge--left": props.edge === "left",
        "resizable-edge--right": props.edge === "right",
        "resizable-edge--top": props.edge === "top",
      }}
      role="separator"
      // A separator between side-by-side regions is a vertical bar
      // (`vertical`); one between stacked regions is a horizontal bar.
      aria-orientation={props.edge === "top" ? "horizontal" : "vertical"}
      aria-label={props.ariaLabel}
      onPointerDown={onHandlePointerDown}
    />
  );
}
