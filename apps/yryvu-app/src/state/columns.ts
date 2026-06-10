// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import {
  ALL_ZONES,
  clampZoneWidth,
  compactColumnLayout,
  defaultColumnLayout,
  orderedVisibleZones,
  sumOfWidths,
  ZONE_SPECS,
  type ColumnSettings,
  type CommitZoneMode,
  type GraphZoneId,
} from "../components/CommitGraph/columns";
import {
  cloneLayout,
  expandToFit,
  shrinkToFit,
} from "./columnCascade";
import { STORAGE_PREFIX } from "./storage";

/// Graph column system. Two pieces of state, separately persisted:
///
/// 1. `graphColumns` — the active layout (width / visible / order per
///    zone). Resize handles, visibility toggles, and the two `Reset
///    columns to …` actions all write here.
///
/// 2. `commitZoneMode` — `text` | `compact`. Sole observer is the
///    GRAPH zone's renderer (controls lane / circle compactness). 1:1
///    with GK's `setZoneColumnMode(commitZone, …)` sa.
///
/// `Reset columns to compact layout` overwrites `graphColumns` with the
/// compact preset (which reorders author left of message and hides
/// dateTime) AND switches `commitZoneMode` to compact. The standalone
/// `Compact Graph Column` toggle only flips `commitZoneMode` — column
/// order / visibility / widths stay on whatever the user has now.
const COLUMN_LAYOUT_KEY = `${STORAGE_PREFIX}graphColumnLayout`;
const COMMIT_ZONE_MODE_KEY = `${STORAGE_PREFIX}commitZoneMode`;

function loadColumnLayout(): Record<GraphZoneId, ColumnSettings> {
  const fallback = defaultColumnLayout();
  const raw = localStorage.getItem(COLUMN_LAYOUT_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const out = { ...fallback };
    for (const id of ALL_ZONES) {
      const candidate = (parsed as Record<string, Partial<ColumnSettings>>)[id];
      if (!candidate || typeof candidate !== "object") continue;
      const merged: ColumnSettings = { ...out[id] };
      if (typeof candidate.width === "number") {
        merged.width = clampZoneWidth(id, candidate.width);
      }
      if (typeof candidate.visible === "boolean") merged.visible = candidate.visible;
      if (typeof candidate.order === "number") merged.order = candidate.order;
      out[id] = merged;
    }
    return out;
  } catch {
    return fallback;
  }
}

function loadCommitZoneMode(): CommitZoneMode {
  return localStorage.getItem(COMMIT_ZONE_MODE_KEY) === "compact" ? "compact" : "text";
}

const [graphColumnsInternal, setGraphColumnsInternal] = createSignal<
  Record<GraphZoneId, ColumnSettings>
>(loadColumnLayout());
const [commitZoneModeInternal, setCommitZoneModeInternal] =
  createSignal<CommitZoneMode>(loadCommitZoneMode());

/// Live container width measured by the ResizeObserver mounted on the
/// graph headers strip in `CommitGraph`. Drives the cascade math below
/// (a zone's resize fans out to its neighbours so `sum === container`)
/// and re-balances on window resize. Initial 0 means "not measured yet"
/// — `setGraphZoneWidth` falls back to a direct write in that window so
/// the first resize doesn't snap to a stale total.
const [containerWidthInternal, setContainerWidthInternal] =
  createSignal<number>(0);

export const graphColumns = graphColumnsInternal;
export const commitZoneMode = commitZoneModeInternal;
export const graphContainerWidth = containerWidthInternal;

function persistLayout(next: Record<GraphZoneId, ColumnSettings>): void {
  localStorage.setItem(COLUMN_LAYOUT_KEY, JSON.stringify(next));
  setGraphColumnsInternal(next);
}

/// Apply a layout to the live signal *without* writing it to localStorage.
/// Pointer-driven resize calls this on every `pointermove` so the cascade
/// math + visible columns stay in sync at frame rate; the caller commits
/// the final layout once on `pointerup` via `commitGraphColumnLayout()`.
function applyLayoutEphemeral(next: Record<GraphZoneId, ColumnSettings>): void {
  setGraphColumnsInternal(next);
}

/// Persist whatever the current layout is. Idempotent. Call from
/// `pointerup` after a sequence of `setGraphZoneWidthInteractive` updates,
/// or after any other batch mutation that intentionally skipped persistence.
export function commitGraphColumnLayout(): void {
  localStorage.setItem(
    COLUMN_LAYOUT_KEY,
    JSON.stringify(graphColumnsInternal()),
  );
}

/// Active settings for a given zone — reads the live `graphColumns` map.
export const activeColumnSettings = (id: GraphZoneId): ColumnSettings =>
  graphColumnsInternal()[id];

/// Visible zones in left-to-right render order, derived from the live
/// layout map. Reactive on width / visibility / order changes.
export const activeOrderedZones = (): GraphZoneId[] =>
  orderedVisibleZones(graphColumnsInternal());

/// Compute the resized layout without applying it. Shared core for the
/// persisting and ephemeral entry points so both paths run identical math.
function computeResizedLayout(
  id: GraphZoneId,
  width: number,
):
  | { kind: "writeThrough"; layout: Record<GraphZoneId, ColumnSettings> }
  | { kind: "cascaded"; layout: Record<GraphZoneId, ColumnSettings> } {
  const cur = graphColumnsInternal();
  const ordered = orderedVisibleZones(cur);
  const idx = ordered.indexOf(id);

  if (idx < 0) {
    // Hidden zone: write straight through, no cascade.
    return {
      kind: "writeThrough",
      layout: {
        ...cur,
        [id]: { ...cur[id], width: clampZoneWidth(id, width) },
      },
    };
  }

  const cw = containerWidthInternal();
  const oldWidth = cur[id].width;
  const newWidth = clampZoneWidth(id, width);

  if (cw <= 0) {
    // No measurement yet — direct write. ResizeObserver will rebalance
    // once it fires.
    return {
      kind: "writeThrough",
      layout: { ...cur, [id]: { ...cur[id], width: newWidth } },
    };
  }

  const next = cloneLayout(cur);
  next[id] = { ...next[id], width: newWidth };

  if (newWidth < oldWidth) {
    expandToFit(next, ordered, cw, idx + 1);
  } else if (newWidth > oldWidth) {
    shrinkToFit(next, ordered, cw, idx - 1);
  }

  return { kind: "cascaded", layout: next };
}

/// Resize a column **and persist**. 1:1 with GK's `adjustResizedGraphZone`
/// (bundle offset 11971000): write the new width, then re-balance so
/// `sum === containerWidth`.
///   - Shrunk → expand zones starting at `idx + 1` (right-side push, last
///     zone absorbs leftover slack).
///   - Grew  → shrink zones starting at `idx - 1` (left-side pull).
/// When the container width hasn't been measured yet (first paint window),
/// fall back to a direct write so the user's intent isn't lost.
///
/// Use this for non-pointer-driven mutations (programmatic resets, restored
/// layouts, etc.). Pointer drag should use the interactive variant + commit
/// pair so localStorage isn't hammered every frame.
export function setGraphZoneWidth(id: GraphZoneId, width: number): void {
  const { layout } = computeResizedLayout(id, width);
  persistLayout(layout);
}

/// Pointer-drag entry point. Same cascade math as `setGraphZoneWidth` but
/// **does not write to localStorage** — caller commits once on `pointerup`
/// via `commitGraphColumnLayout()`. At ~60 fps a drag can fire 60+
/// `pointermove`s per second; persisting each one was visibly slow.
export function setGraphZoneWidthInteractive(
  id: GraphZoneId,
  width: number,
): void {
  const { layout } = computeResizedLayout(id, width);
  applyLayoutEphemeral(layout);
}

/// Splitter pair resize: redistribute width between two ADJACENT visible
/// zones without rippling into the rest of the row. Used by
/// `GraphColumnResizer` — drag the handle between col A and col B,
/// only A and B change (the handle follows the cursor like a window
/// border between two adjacent panes).
///
/// Width is conserved (`final_left + final_right === start_left + start_right`)
/// modulo the per-zone min clamps. If a request would push either side
/// below its `minimumWidth`, the deficit is absorbed by the other side so
/// the pair total stays constant — the handle stops moving at that limit
/// rather than dragging the wrong side past zero.
///
/// Ephemeral only: caller commits once on `pointerup` via
/// `commitGraphColumnLayout()` — same contract as
/// `setGraphZoneWidthInteractive`.
export function setGraphZonePairInteractive(
  leftZone: GraphZoneId,
  leftWidth: number,
  rightZone: GraphZoneId,
  rightWidth: number,
): void {
  const cur = graphColumnsInternal();
  const totalAvailable = cur[leftZone].width + cur[rightZone].width;
  const minLeft = ZONE_SPECS[leftZone].minimumWidth;
  const minRight = ZONE_SPECS[rightZone].minimumWidth;

  let finalLeft = Math.round(leftWidth);
  let finalRight = totalAvailable - finalLeft;

  if (finalLeft < minLeft) {
    finalLeft = minLeft;
    finalRight = totalAvailable - finalLeft;
  }
  if (finalRight < minRight) {
    finalRight = minRight;
    finalLeft = totalAvailable - finalRight;
  }
  // If the pair can't even fit both minimums, leave things alone rather
  // than degrade into negative widths — the container is too narrow.
  if (finalLeft < minLeft || finalRight < minRight) return;

  // `rightWidth` is a hint from the caller; the conservation rule above
  // already pinned `finalRight`. Acknowledge it to keep callers from
  // wondering why their second arg was ignored when the constraints
  // didn't bind.
  void rightWidth;

  const next = cloneLayout(cur);
  next[leftZone] = { ...next[leftZone], width: finalLeft };
  next[rightZone] = { ...next[rightZone], width: finalRight };
  applyLayoutEphemeral(next);
}

/// ResizeObserver entry point. GK's `ensureZoneWidthsMatchGraphWidth`:
/// when the container resizes, re-balance so the visible columns keep
/// `sum === containerWidth`. Idempotent — if widths already match, this
/// is a no-op (no persist).
export function ensureColumnWidthsFitContainer(cw: number): void {
  if (cw <= 0) return;
  setContainerWidthInternal(cw);

  const cur = graphColumnsInternal();
  const ordered = orderedVisibleZones(cur);
  if (ordered.length === 0) return;

  const total = sumOfWidths(ordered, cur);
  if (total === cw) return;

  const next = cloneLayout(cur);
  if (total > cw) {
    shrinkToFit(next, ordered, cw, ordered.length - 1);
  } else {
    expandToFit(next, ordered, cw, 0);
  }
  persistLayout(next);
}

/// Toggle a zone's visibility.
export function setGraphZoneVisible(id: GraphZoneId, visible: boolean): void {
  const cur = graphColumnsInternal();
  persistLayout({ ...cur, [id]: { ...cur[id], visible } });
  // After (un)hiding, rebalance against the live container width so the
  // newly-visible column doesn't leave a gap and a hidden one doesn't
  // create overflow.
  const cw = containerWidthInternal();
  if (cw > 0) ensureColumnWidthsFitContainer(cw);
}

/// Flip the GRAPH zone's compact rendering mode. Affects only the graph
/// zone's lane / node sizing — column order, visibility, and widths
/// elsewhere are untouched. 1:1 with GK's `Compact Graph Column` toggle.
export function setCommitZoneMode(mode: CommitZoneMode): void {
  localStorage.setItem(COMMIT_ZONE_MODE_KEY, mode);
  setCommitZoneModeInternal(mode);
}

export function toggleCommitZoneMode(): void {
  setCommitZoneMode(commitZoneModeInternal() === "compact" ? "text" : "compact");
}

/// `Reset columns to default layout` action. Overwrites the layout
/// with bundle defaults and forces the graph zone back to text mode.
export function resetColumnsToDefaultLayout(): void {
  persistLayout(defaultColumnLayout());
  setCommitZoneMode("text");
  const cw = containerWidthInternal();
  if (cw > 0) ensureColumnWidthsFitContainer(cw);
}

/// `Reset columns to compact layout` action. Overwrites the layout
/// with the compact preset (author moves left of message; dateTime
/// is hidden) and switches the graph zone to compact rendering.
export function resetColumnsToCompactLayout(): void {
  persistLayout(compactColumnLayout());
  setCommitZoneMode("compact");
  const cw = containerWidthInternal();
  if (cw > 0) ensureColumnWidthsFitContainer(cw);
}
