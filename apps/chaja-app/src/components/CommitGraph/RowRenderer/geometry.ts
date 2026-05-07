// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RenderDims } from "./dims";

export const ROW_HEIGHT = 28;
export const PALETTE_SIZE = 10;

// GK's `eC`/`eT` lookup tables: angle (degrees) → cos/sin. Convention:
// 0=LEFT, 90=DOWN, 180=RIGHT, 270=UP (y grows down in SVG).
const COS_TABLE: Record<number, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN_TABLE: Record<number, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };

export type ArcAngle = 0 | 90 | 180 | 270;

export function laneCenterX(lane: number, dims: RenderDims): number {
  return dims.gutter + lane * dims.laneWidth + dims.laneWidth / 2;
}

export function laneColor(col: number): string {
  return `var(--lane-${col % PALETTE_SIZE})`;
}

/** GK's `eE(e, t, o)`: arc endpoint + straight-line-padding offset for a
 *  cardinal angle on a circle of radius `dims.edgeArcApproach` at (cx, cy). */
function arcEndpoint(
  cx: number,
  cy: number,
  angle: ArcAngle,
  dims: RenderDims,
) {
  const cosA = COS_TABLE[angle];
  const sinA = SIN_TABLE[angle];
  return {
    x: cx - dims.edgeArcApproach * cosA,
    y: cy + dims.edgeArcApproach * sinA,
    xOffset: -(cosA * dims.edgeArcPadding),
    yOffset: sinA * dims.edgeArcPadding,
  };
}

/** GK's `eI(e, t, o, r, i, n, s, l)` inner path-builder: quarter-arc with
 *  straight-line padding on each side. `cx, cy` is the elbow's turn point. */
export function arcPath(
  cx: number,
  cy: number,
  startAngle: ArcAngle,
  endAngle: ArcAngle,
  dims: RenderDims,
): string {
  const s = arcEndpoint(cx, cy, startAngle, dims);
  const l = arcEndpoint(cx, cy, endAngle, dims);
  const leadIn =
    l.xOffset !== 0 ? `H ${s.x + l.xOffset}` : `V ${s.y + l.yOffset}`;
  const leadOut = s.xOffset !== 0 ? `H ${l.x}` : `V ${l.y}`;
  return `M ${s.x} ${s.y} ${leadIn} A ${dims.arcRadius} ${dims.arcRadius} 0 0 0 ${
    l.x + s.xOffset
  } ${l.y + s.yOffset} ${leadOut}`;
}
