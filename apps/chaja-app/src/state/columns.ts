// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import {
  ALL_ZONES,
  clampZoneWidth,
  compactColumnLayout,
  defaultColumnLayout,
  orderedVisibleZones,
  type ColumnSettings,
  type CommitZoneMode,
  type GraphZoneId,
} from "../components/CommitGraph/columns";
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

export const graphColumns = graphColumnsInternal;
export const commitZoneMode = commitZoneModeInternal;

function persistLayout(next: Record<GraphZoneId, ColumnSettings>): void {
  localStorage.setItem(COLUMN_LAYOUT_KEY, JSON.stringify(next));
  setGraphColumnsInternal(next);
}

/// Active settings for a given zone — reads the live `graphColumns` map.
export const activeColumnSettings = (id: GraphZoneId): ColumnSettings =>
  graphColumnsInternal()[id];

/// Visible zones in left-to-right render order, derived from the live
/// layout map. Reactive on width / visibility / order changes.
export const activeOrderedZones = (): GraphZoneId[] =>
  orderedVisibleZones(graphColumnsInternal());

/// Resize a column. Mirrors GK's `adjustResizedGraphZone` —
/// `expandZoneWidthsToFitWidth` / `shrinkZoneWidthsToFitWidth` cascade
/// (bundle ~458970): the delta absorbed by the resized zone is paid
/// back to (or taken from) the visible zones to its right, in order,
/// each zone clamped to its own `[minimumWidth, maximumWidth]`. When
/// the cascade hits the right edge with delta still to spend, the
/// remainder stays on the resized zone (so the user feels a hard stop
/// rather than the column spilling through other columns).
export function setGraphZoneWidth(id: GraphZoneId, width: number): void {
  const cur = graphColumnsInternal();
  const ordered = orderedVisibleZones(cur);
  const idx = ordered.indexOf(id);
  if (idx < 0) {
    // Resizing a hidden zone — write straight through, no cascade.
    persistLayout({
      ...cur,
      [id]: { ...cur[id], width: clampZoneWidth(id, width) },
    });
    return;
  }

  const oldWidth = cur[id].width;
  const requestedNew = clampZoneWidth(id, width);
  const next: Record<GraphZoneId, ColumnSettings> = {
    ...cur,
    [id]: { ...cur[id], width: requestedNew },
  };
  // Positive `slack` means the resized zone shrunk — neighbours to the
  // right need to grow by that much. Negative means it grew — they need
  // to shrink. Walk in left-to-right order so the closest neighbour
  // absorbs first (matches GK; the user feels the resize "push" the
  // adjacent column rather than re-flowing the far end of the row).
  let slack = oldWidth - requestedNew;
  for (let i = idx + 1; i < ordered.length && slack !== 0; i += 1) {
    const rid = ordered[i];
    const r = next[rid];
    const desired = r.width + slack;
    const clamped = clampZoneWidth(rid, desired);
    const consumed = clamped - r.width;
    next[rid] = { ...r, width: clamped };
    slack -= consumed;
  }
  // If `slack` is still non-zero, every column to the right is at its
  // bound. Reflect that on the resized zone — the user can't go past
  // what the cascade can absorb.
  if (slack !== 0) {
    const finalSelf = clampZoneWidth(id, requestedNew + slack);
    next[id] = { ...next[id], width: finalSelf };
  }
  persistLayout(next);
}

/// Toggle a zone's visibility.
export function setGraphZoneVisible(id: GraphZoneId, visible: boolean): void {
  const cur = graphColumnsInternal();
  persistLayout({ ...cur, [id]: { ...cur[id], visible } });
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
}

/// `Reset columns to compact layout` action. Overwrites the layout
/// with the compact preset (author moves left of message; dateTime
/// is hidden) and switches the graph zone to compact rendering.
export function resetColumnsToCompactLayout(): void {
  persistLayout(compactColumnLayout());
  setCommitZoneMode("compact");
}
