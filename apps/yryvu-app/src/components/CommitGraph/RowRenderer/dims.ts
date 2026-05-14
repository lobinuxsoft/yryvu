// SPDX-License-Identifier: AGPL-3.0-or-later

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

export function getRenderDims(compact: boolean): RenderDims {
  return compact ? COMPACT_DIMS : DEFAULT_DIMS;
}
