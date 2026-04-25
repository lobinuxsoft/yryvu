// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Column system for the commit graph. 1:1 with GitKraken's
 * `graphZones` enum + the `*_ZONE_DEFAULT_WIDTH` / `*_COMPACT_WIDTH` /
 * `*_MAX_WIDTH` constants extracted from the bundle (2026-04-25).
 *
 * Bundle source: `/var/mnt/DATA/gitkraken-extract/.../render.bundle.js`
 *
 * Default mode = pills + lane graph + commit message visible. Author /
 * date-time / SHA columns ship hidden (matching the GK first-launch
 * defaults as captured in the user's eggscape screenshots) and surface
 * via the column-settings popover.
 */

export type GraphZoneId =
  | "ref"
  | "graph"
  | "commitMessage"
  | "commitAuthor"
  | "commitDateTime"
  | "commitSha";

export type GraphColumnMode = "default" | "compact";

export interface ZoneSpec {
  /** Width when `graphColumnMode === "default"`. */
  default: number;
  /** Width when `graphColumnMode === "compact"`. */
  compact: number;
  /** Lower clamp for user resize. */
  min: number;
  /** Upper clamp for user resize. */
  max: number;
  /** Whether the zone ships visible on first launch. */
  defaultVisible: boolean;
  /** Header label (capitalized as GK paints it). */
  label: string;
}

/**
 * Per-zone defaults. The `graph` zone has no GK constant (GK derives its
 * width from the lane content), so we set a comfortable 200 default,
 * 100 compact (lane width drops in compact mode anyway), and a generous
 * max so wide repos can stretch it without bumping into the cap.
 */
export const ZONE_SPECS: Record<GraphZoneId, ZoneSpec> = {
  ref: {
    default: 130,
    compact: 32,
    min: 32,
    max: 300,
    defaultVisible: true,
    label: "Branch / Tag",
  },
  graph: {
    default: 200,
    compact: 100,
    min: 80,
    max: 800,
    defaultVisible: true,
    label: "Graph",
  },
  commitMessage: {
    default: 300,
    compact: 500,
    min: 200,
    max: 800,
    defaultVisible: true,
    label: "Commit Message",
  },
  commitAuthor: {
    default: 130,
    compact: 32,
    min: 32,
    max: 175,
    defaultVisible: false,
    label: "Author",
  },
  commitDateTime: {
    default: 130,
    compact: 130,
    min: 100,
    max: 175,
    defaultVisible: false,
    label: "Date / Time",
  },
  commitSha: {
    default: 130,
    compact: 130,
    min: 60,
    max: 200,
    defaultVisible: false,
    label: "SHA",
  },
};

/**
 * Render order. Mirrors GK's left-to-right column layout. Reorder is a
 * GK feature (drag-to-reorder via react-dnd per doc 10) deferred to a
 * follow-up issue — the bundle ships this fixed order as the default.
 */
export const ZONE_ORDER: GraphZoneId[] = [
  "ref",
  "graph",
  "commitMessage",
  "commitAuthor",
  "commitDateTime",
  "commitSha",
];

/** Clamp a width to the zone's [min, max] range. */
export function clampZoneWidth(id: GraphZoneId, width: number): number {
  const spec = ZONE_SPECS[id];
  return Math.max(spec.min, Math.min(spec.max, Math.round(width)));
}

/** Produce a fresh widths map per the requested mode. */
export function presetWidths(
  mode: GraphColumnMode,
): Record<GraphZoneId, number> {
  const out = {} as Record<GraphZoneId, number>;
  for (const id of ZONE_ORDER) {
    out[id] = mode === "compact" ? ZONE_SPECS[id].compact : ZONE_SPECS[id].default;
  }
  return out;
}

/** Produce a fresh visibility map per first-launch defaults. */
export function presetVisibility(): Record<GraphZoneId, boolean> {
  const out = {} as Record<GraphZoneId, boolean>;
  for (const id of ZONE_ORDER) out[id] = ZONE_SPECS[id].defaultVisible;
  return out;
}
