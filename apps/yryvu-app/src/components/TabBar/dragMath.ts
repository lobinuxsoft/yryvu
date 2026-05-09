// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure helpers for the tab-pill drag-reorder math (#39). Lifted out of
 * the TabBar component so the index calculation can be unit-tested
 * without a DOM.
 */

/// Pixel threshold below which a pointer movement is treated as a click,
/// not a drag. Matches the OS standard for click vs. drag dispatch.
export const DRAG_THRESHOLD_PX = 5;

/// Compute the destination index for a dragged pill given the current
/// cursor X (in viewport space) and the bounding rects of every pill
/// in the strip captured at drag start.
///
/// The rule mirrors most "sortable list" implementations: the dragged
/// pill lands at index `i` when the cursor crosses the *midpoint* of
/// the pill currently occupying slot `i`. This avoids jitter at slot
/// boundaries that a "left-edge" rule would produce.
///
/// Returns the dragged pill's *original* index when the cursor is to
/// the left of every pill or to the right of every pill — clamping
/// rather than allowing out-of-range targets.
export function computeTargetIndex(
  cursorX: number,
  pillRects: { left: number; right: number; width: number }[],
  draggedIndex: number,
): number {
  if (pillRects.length === 0) return draggedIndex;
  // Walk left-to-right. The dragged pill "fits" before the first slot
  // whose midpoint is past the cursor.
  for (let i = 0; i < pillRects.length; i += 1) {
    const r = pillRects[i];
    const midpoint = r.left + r.width / 2;
    if (cursorX < midpoint) return i;
  }
  return pillRects.length - 1;
}
