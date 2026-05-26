// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reusable single-edge resize handle (issues #134 + #36). Renders a
 * thin drag stripe on the panel's specified edge; pointer events live
 * at the document level so a fast drag that leaves the handle's hitbox
 * doesn't drop tracking. The drag stream calls `setWidth(..., false)`
 * per pointermove (ephemeral) and `commit()` once on pointerup so the
 * persist round-trip happens once per drag gesture.
 *
 * `edge: "left"` grows the panel when the cursor moves LEFT — the
 * right inspector's left-edge handle pattern. `edge: "right"` grows
 * the panel when the cursor moves RIGHT — the left sidebar's
 * right-edge handle pattern.
 */

import { type Accessor, onCleanup } from "solid-js";

interface Props {
  /// Which edge of the panel the handle sits on.
  edge: "left" | "right";
  /// Reactive width accessor — read at drag-start to anchor the
  /// gesture.
  width: Accessor<number>;
  /// Apply a new width to the panel. `persist=false` during drag,
  /// the wrapper fires `commit()` once on pointerup.
  setWidth: (next: number, persist?: boolean) => void;
  /// Clamp a candidate width against the panel's [min, max] for the
  /// current viewport. Callers compute `max` from `window.innerWidth`
  /// minus the chrome they need to keep visible.
  clamp: (width: number, maxWidth: number) => number;
  /// Viewport-derived upper bound recomputed per-frame. The handle
  /// passes this to `clamp` so a viewport shrink mid-drag pins the
  /// panel at its current ceiling instead of overflowing.
  viewportMaxWidth: () => number;
  /// Force-persist the live width. Fires once on pointerup so we
  /// round-trip one IPC write per drag gesture instead of one per
  /// pixel.
  commit: () => void;
  /// Accessible label surfaced as `aria-label` on the handle.
  ariaLabel: string;
}

export function ResizableEdge(props: Props) {
  let dragStartX = 0;
  let dragStartWidth = 0;

  const onPointerMove = (e: PointerEvent) => {
    const delta = e.clientX - dragStartX;
    // Left-edge handle: cursor LEFT grows the panel (delta<0 → next
    // > startWidth). Right-edge handle: cursor RIGHT grows the panel
    // (delta>0 → next > startWidth).
    const next = props.edge === "left"
      ? dragStartWidth - delta
      : dragStartWidth + delta;
    props.setWidth(props.clamp(next, props.viewportMaxWidth()), false);
  };

  const onPointerUp = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    props.commit();
  };

  const onHandlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStartX = e.clientX;
    dragStartWidth = props.width();
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
      }}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.ariaLabel}
      onPointerDown={onHandlePointerDown}
    />
  );
}
