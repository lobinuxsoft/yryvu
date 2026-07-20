// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

/**
 * Render dimensions — 1:1 with the GK bundle's `graphZoneModeConstants`
 * factory (module 21792). The arc constants (`edgeArcApproach`,
 * `edgeArcPadding`, `arcRadius`) are mode-INDEPENDENT in GK — only
 * the lane geometry (lane width, gutter, node diameter) and the
 * stroke width shrink in compact. Earlier versions of chajá scaled
 * the arc constants too, which broke the geometry: stub lines no
 * longer met the arc cleanly, so cross-lane edges rendered with
 * disconnected segments (#154).
 *
 * GK constants:
 *   - `COMMIT_ZONE_EDGE_ARC_RADIUS  = 11` (both modes)
 *   - `COMMIT_ZONE_EDGE_ARC_PADDING = 3`  (both modes)
 *   - `COMMIT_COLUMN_WIDTH`         : 22 default / 10 compact
 *   - `COMMIT_NODE_DIAMETER`        : 22 default / 10 compact
 *   - `COMMIT_MERGE_NODE_DIAMETER`  : 12 default / 10 compact
 *   - `COMMIT_ZONE_GUTTER_WIDTH`    : 28 default / 10 compact
 *   - `COMMIT_ZONE_LINE_WIDTH`      : 2  default / 1  compact
 */
export interface RenderDims {
  laneWidth: number;
  gutter: number;
  commitRadius: number;
  mergeRadius: number;
  edgeArcApproach: number;
  edgeArcPadding: number;
  arcRadius: number;
  lineWidth: number;
}

const DEFAULT_DIMS: RenderDims = {
  laneWidth: 22,
  gutter: 28,
  commitRadius: 11,
  mergeRadius: 6,
  edgeArcApproach: 11,
  edgeArcPadding: 3,
  arcRadius: 8,
  lineWidth: 2,
};

const COMPACT_DIMS: RenderDims = {
  laneWidth: 10,
  gutter: 10,
  commitRadius: 5,
  mergeRadius: 5,
  edgeArcApproach: 11,
  edgeArcPadding: 3,
  arcRadius: 8,
  lineWidth: 1,
};

// Themeable visual params (#301). Only the commit-node radius and the
// edge stroke width are exposed — they flow through `dims` numerically so
// the circle, lane-streak height and SVG extent stay consistent, without
// touching ROW_HEIGHT / lane X / arc geometry (which would reflow the
// virtualizer). Compact density keeps its own smaller constants.
let hydratedCommitRadius = DEFAULT_DIMS.commitRadius;
let hydratedLineWidth = DEFAULT_DIMS.lineWidth;

const [dimsVersion, bumpDimsVersion] = createSignal(0);

function readVar(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/// Re-read the graph's themeable CSS variables from the document root.
/// Call on graph mount and whenever the active theme changes (its vars
/// must already be injected — see `themeAppliedVersion`). Bumps a version
/// signal so the reactive `getRenderDims` callers re-render.
export function hydrateGraphDims(): void {
  hydratedCommitRadius = readVar("--graph-node-radius", DEFAULT_DIMS.commitRadius);
  hydratedLineWidth = readVar("--graph-edge-width", DEFAULT_DIMS.lineWidth);
  bumpDimsVersion((v) => v + 1);
}

export function getRenderDims(compact: boolean): RenderDims {
  // Establish a reactive dependency so a theme switch re-renders the graph.
  dimsVersion();
  if (compact) return COMPACT_DIMS;
  return {
    ...DEFAULT_DIMS,
    commitRadius: hydratedCommitRadius,
    lineWidth: hydratedLineWidth,
  };
}
