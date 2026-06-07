// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ALL_ZONES,
  clampZoneWidth,
  isLastVisibleZone,
  sumOfWidths,
  ZONE_SPECS,
  type ColumnSettings,
  type GraphZoneId,
} from "../components/CommitGraph/columns";

// ---------------------------------------------------------------------------
// Cascade helpers — port of GK's `expand/shrinkZoneWidthsToFitWidth`.
// Pure functions over a layout map: callers stage a fresh shallow copy
// (`cloneLayout`) before invoking the in-place mutators and persist the
// result. Kept out of `columns.ts` so the signal/persistence layer stays
// readable and this math is unit-testable in isolation.
// ---------------------------------------------------------------------------

export function isExpandable(
  id: GraphZoneId,
  ordered: GraphZoneId[],
  layout: Record<GraphZoneId, ColumnSettings>,
): boolean {
  // The last visible zone has no upper bound — it absorbs leftover slack
  // (mirrors GK's `!isLastZone && ct > preferredWidth ⇒ ct = preferredWidth`
  // skip in `expandZoneWidthsToFitWidth`).
  if (isLastVisibleZone(id, ordered)) return true;
  return layout[id].width < ZONE_SPECS[id].maximumWidth;
}

/// Walk right from `fromIdx`; if nothing is found, wrap to 0 and continue
/// up to `fromIdx`. The wrap-around mirrors GK's `(0, ja.fW)` heuristic
/// where any non-saturated zone can absorb growth — which is what makes
/// shrinking the last column still close the resulting gap (the loop wraps
/// back to whichever zone (typically the leftmost) still has room).
export function nextExpandable(
  ordered: GraphZoneId[],
  layout: Record<GraphZoneId, ColumnSettings>,
  fromIdx: number,
): GraphZoneId | null {
  const start = Math.max(0, fromIdx);
  for (let i = start; i < ordered.length; i += 1) {
    if (isExpandable(ordered[i], ordered, layout)) return ordered[i];
  }
  for (let i = 0; i < start; i += 1) {
    if (isExpandable(ordered[i], ordered, layout)) return ordered[i];
  }
  return null;
}

/// Walk left from `fromIdx`; on miss, wrap to the right end and continue
/// down to `fromIdx + 1`. Symmetric with `nextExpandable` so growing the
/// first column still finds room to take from someone.
export function nextShrinkable(
  ordered: GraphZoneId[],
  layout: Record<GraphZoneId, ColumnSettings>,
  fromIdx: number,
): GraphZoneId | null {
  const start = Math.min(ordered.length - 1, fromIdx);
  for (let i = start; i >= 0; i -= 1) {
    const id = ordered[i];
    if (layout[id].width > ZONE_SPECS[id].minimumWidth) return id;
  }
  for (let i = ordered.length - 1; i > start; i -= 1) {
    const id = ordered[i];
    if (layout[id].width > ZONE_SPECS[id].minimumWidth) return id;
  }
  return null;
}

/// Loop invariant: walk the ordered zones starting at `fromIdx` to the
/// right; on each iteration grow the first expandable zone enough to
/// close the gap, capping at its `maximumWidth` (except for the rightmost
/// zone, which absorbs whatever is left). Stops when `sum === containerWidth`
/// or no zone can grow further.
export function expandToFit(
  layout: Record<GraphZoneId, ColumnSettings>,
  ordered: GraphZoneId[],
  containerWidth: number,
  fromIdx: number,
): void {
  // Guard at 2× ordered.length: each iteration either grows a zone (and
  // saturates it for next time) or breaks on no-change. The loop can never
  // need more passes than there are zones to bump.
  let total = sumOfWidths(ordered, layout);
  let guard = ordered.length * 2 + 2;
  while (total < containerWidth && guard-- > 0) {
    const id = nextExpandable(ordered, layout, fromIdx);
    if (!id) break;
    const others = sumOfWidths(ordered, layout, id);
    let candidate = containerWidth - others;
    if (!isLastVisibleZone(id, ordered)) {
      candidate = Math.min(candidate, ZONE_SPECS[id].maximumWidth);
    }
    candidate = isLastVisibleZone(id, ordered)
      ? Math.max(ZONE_SPECS[id].minimumWidth, Math.round(candidate))
      : clampZoneWidth(id, candidate);
    if (candidate === layout[id].width) break;
    layout[id] = { ...layout[id], width: candidate };
    total = sumOfWidths(ordered, layout);
  }
}

/// Mirror of `expandToFit` but walking *left* from `fromIdx`. Each
/// iteration shrinks the first shrinkable zone enough to close the
/// excess. Stops when `sum === containerWidth` or no zone can shrink.
export function shrinkToFit(
  layout: Record<GraphZoneId, ColumnSettings>,
  ordered: GraphZoneId[],
  containerWidth: number,
  fromIdx: number,
): void {
  let total = sumOfWidths(ordered, layout);
  let guard = ordered.length * 2 + 2;
  while (total > containerWidth && guard-- > 0) {
    const id = nextShrinkable(ordered, layout, fromIdx);
    if (!id) break;
    const others = sumOfWidths(ordered, layout, id);
    const candidate = clampZoneWidth(id, containerWidth - others);
    if (candidate === layout[id].width) break;
    layout[id] = { ...layout[id], width: candidate };
    total = sumOfWidths(ordered, layout);
  }
}

export function cloneLayout(
  cur: Record<GraphZoneId, ColumnSettings>,
): Record<GraphZoneId, ColumnSettings> {
  const out = {} as Record<GraphZoneId, ColumnSettings>;
  for (const id of ALL_ZONES) out[id] = { ...cur[id] };
  return out;
}
