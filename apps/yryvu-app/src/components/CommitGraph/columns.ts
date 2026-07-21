// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Column system for the commit graph. Modeled after GitKraken's
 * `graphZoneMetaData` (extracted from the bundle 2026-04-25), but
 * simplified now that we know how the toggle and presets actually
 * interact:
 *
 * - There's a SINGLE active configuration per zone — `width`, `visible`,
 *   `order`. The user resizes / toggles into that one set.
 * - `commitZoneMode` (Text | Compact) is a SEPARATE flag that only
 *   affects how the GRAPH zone renders internally. It does not reorder
 *   other zones or change their widths.
 * - The bundle exposes two named presets — `defaultColSettings` and
 *   `compactColSettings` per zone — surfaced as `Reset columns to
 *   default layout` and `Reset columns to compact layout` actions.
 *   These are destructive resets that overwrite the user's current
 *   widths / visibility / order with the preset's values.
 */

export type GraphZoneId =
  | "ref"
  | "graph"
  | "commitMessage"
  | "commitAuthor"
  | "commitDateTime"
  | "commitSha";

/** GK's `GraphColumnMode`. Only the GRAPH zone observes it. */
export type CommitZoneMode = "text" | "compact";

export interface ColumnSettings {
  width: number;
  visible: boolean;
  order: number;
}

export interface ZoneSpec {
  defaults: ColumnSettings;
  compact: ColumnSettings;
  minimumWidth: number;
  maximumWidth: number;
  label: string;
}

/**
 * 1:1 with `graphZoneMetaData` per the bundle:
 *
 * - default order: ref=0, graph=1, message=2, author=3, dateTime=5, sha=6
 * - compact order: ref=0, graph=1, author=2, message=3, dateTime=5, sha=6
 *   (author swaps in front of message; dateTime is hidden in compact)
 *
 * Widths come from the `*_DEFAULT_WIDTH` / `*_COMPACT_WIDTH` constants.
 */
export const ZONE_SPECS: Record<GraphZoneId, ZoneSpec> = {
  ref: {
    defaults: { width: 130, visible: true, order: 0 },
    compact: { width: 32, visible: true, order: 0 },
    minimumWidth: 32,
    maximumWidth: 300,
    label: "Branch / Tag",
  },
  graph: {
    defaults: { width: 150, visible: true, order: 1 },
    compact: { width: 150, visible: true, order: 1 },
    // `COMMIT_ZONE_DEFAULT_VIEWPORT_WIDTH_MIN` = node 22 + padding 3 + 3 +
    // gutter 28. The maximum is a placeholder: the graph zone is the only
    // fluid one, so its real cap is the lane content width published at
    // runtime through `setGraphContentWidth` (see `zoneMaxWidth`).
    minimumWidth: 56,
    maximumWidth: 800,
    label: "Graph",
  },
  commitMessage: {
    defaults: { width: 300, visible: true, order: 2 },
    compact: { width: 500, visible: true, order: 3 },
    minimumWidth: 50,
    maximumWidth: 800,
    label: "Commit Message",
  },
  commitAuthor: {
    defaults: { width: 130, visible: true, order: 3 },
    compact: { width: 32, visible: true, order: 2 },
    minimumWidth: 32,
    maximumWidth: 175,
    label: "Author",
  },
  commitDateTime: {
    defaults: { width: 130, visible: true, order: 5 },
    compact: { width: 130, visible: false, order: 5 },
    minimumWidth: 50,
    maximumWidth: 175,
    label: "Date / Time",
  },
  commitSha: {
    defaults: { width: 130, visible: true, order: 6 },
    compact: { width: 130, visible: true, order: 6 },
    minimumWidth: 50,
    // DIVERGES from the bundle, deliberately. GK ships
    // `COMMIT_SHA_ZONE_MAX_WIDTH = 100` while both of its own presets are
    // 130 — so the very first drag of the SHA column snaps it below its
    // default and it can never return. We keep the cap above the presets.
    maximumWidth: 200,
    label: "SHA",
  },
};

/// Runtime cap for the graph zone: the natural width of the lane content
/// (`gutter + (maxLane + 1) * laneWidth + padding`), republished by the
/// layout hook whenever the loaded rows fan out to a new maximum lane.
/// Mirrors GK's `updateCommitZoneContentWidthFromChange`, which assigns
/// `commitZone.maximumWidth = contentWidth` — the graph is the one zone
/// whose ceiling floats with the shape of the history rather than being a
/// constant. Starts at the static spec value until the first measurement.
let graphContentWidth = ZONE_SPECS.graph.maximumWidth;

/// Publish a new lane content width. Returns `true` when the value
/// actually changed, so callers can skip a pointless re-balance.
export function setGraphContentWidth(px: number): boolean {
  const next = Math.max(ZONE_SPECS.graph.minimumWidth, Math.round(px));
  if (next === graphContentWidth) return false;
  graphContentWidth = next;
  return true;
}

/// Upper bound for a zone. Constant for every zone except the graph,
/// whose cap tracks the lane content width. Always read widths through
/// this rather than `ZONE_SPECS[id].maximumWidth` so the fluid zone can't
/// be clamped against a stale constant.
export function zoneMaxWidth(id: GraphZoneId): number {
  return id === "graph" ? graphContentWidth : ZONE_SPECS[id].maximumWidth;
}

/** Every zone id, in storage-stable order. */
export const ALL_ZONES: GraphZoneId[] = [
  "ref",
  "graph",
  "commitMessage",
  "commitAuthor",
  "commitDateTime",
  "commitSha",
];

/** Build a fresh `Record<id, ColumnSettings>` from the bundle defaults. */
export function defaultColumnLayout(): Record<GraphZoneId, ColumnSettings> {
  const out = {} as Record<GraphZoneId, ColumnSettings>;
  for (const id of ALL_ZONES) out[id] = { ...ZONE_SPECS[id].defaults };
  return out;
}

/** Build the compact preset layout. */
export function compactColumnLayout(): Record<GraphZoneId, ColumnSettings> {
  const out = {} as Record<GraphZoneId, ColumnSettings>;
  for (const id of ALL_ZONES) out[id] = { ...ZONE_SPECS[id].compact };
  return out;
}

/** Clamp a width to a zone's [min, max] — max via `zoneMaxWidth`. */
export function clampZoneWidth(id: GraphZoneId, width: number): number {
  const spec = ZONE_SPECS[id];
  return Math.max(spec.minimumWidth, Math.min(zoneMaxWidth(id), Math.round(width)));
}

/** Visible zones in left-to-right render order. */
export function orderedVisibleZones(
  layout: Record<GraphZoneId, ColumnSettings>,
): GraphZoneId[] {
  return ALL_ZONES.filter((id) => layout[id].visible).sort(
    (a, b) => layout[a].order - layout[b].order,
  );
}

/// Sum of `currentWidth` for the zones in `ordered`, optionally excluding
/// one. Mirrors GK's `(0, ja.al)(zones, excludeType?)` helper used by
/// `expand/shrinkZoneWidthsToFitWidth`.
export function sumOfWidths(
  ordered: GraphZoneId[],
  layout: Record<GraphZoneId, ColumnSettings>,
  excludeId?: GraphZoneId,
): number {
  let total = 0;
  for (const id of ordered) {
    if (id === excludeId) continue;
    total += layout[id].width;
  }
  return total;
}

/// `true` iff `id` is the rightmost visible zone in `ordered`. The last
/// zone's `maximumWidth` cap is ignored when expanding so it absorbs any
/// remainder needed to keep `sum === containerWidth`. Mirrors GK's
/// `(0, ja.z)(type, zones)`.
export function isLastVisibleZone(
  id: GraphZoneId,
  ordered: GraphZoneId[],
): boolean {
  return ordered.length > 0 && ordered[ordered.length - 1] === id;
}

/** Format a unix-seconds timestamp for the date-time column. */
export function formatCommitDateTime(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "";
  const date = new Date(unixSeconds * 1000);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const dateStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  return `${dateStr}, ${time}`;
}
