// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RenderDims } from "./dims";
import {
  arcPath,
  laneCenterX,
  laneColor,
  ROW_HEIGHT,
  type ArcAngle,
} from "./geometry";

/**
 * Three render primitives, each with same-column and cross-column forms:
 *
 * - **passThrough** (only one form) — full-height vertical at `col`.
 * - **startingEdge** — leaves current commit toward a parent.
 *   - same-column (first-parent same lane / extra-parent same lane):
 *     vertical from `midY` to `ROW_HEIGHT` at `col`.
 *   - cross-column (merge extra parent at another lane): L-shape
 *     — stub at bottom of `edgeCol`, quarter-arc at `(edgeCol ± 11, 25)`,
 *     long horizontal at `midY` to `nodeCol`.
 * - **endingEdge** — terminates at current commit from an edge that was
 *   in flight from a prior row.
 *   - same-column: vertical from `0` to `midY` at `col`.
 *   - cross-column (first-parent at different lane): L-shape mirrored —
 *     stub at top of `edgeCol`, arc at `(edgeCol ± 11, 3)`, horizontal
 *     at `midY` to `nodeCol`.
 */

export function renderPassThrough(col: number, dims: RenderDims) {
  const x = laneCenterX(col, dims);
  return (
    <line
      x1={x}
      y1={0}
      x2={x}
      y2={ROW_HEIGHT}
      stroke={laneColor(col)}
      stroke-width={dims.lineWidth}
    />
  );
}

export function renderStartingEdge(
  edgeCol: number,
  nodeCol: number,
  dims: RenderDims,
) {
  const edgeX = laneCenterX(edgeCol, dims);
  const color = laneColor(edgeCol);
  if (edgeCol === nodeCol) {
    return (
      <line
        x1={edgeX}
        y1={ROW_HEIGHT / 2}
        x2={edgeX}
        y2={ROW_HEIGHT}
        stroke={color}
        stroke-width={dims.lineWidth}
      />
    );
  }
  const nodeX = laneCenterX(nodeCol, dims);
  const sign = nodeX > edgeX ? 1 : -1;
  const h = sign * dims.edgeArcApproach;
  const arcCx = edgeX + h;
  const arcCy = ROW_HEIGHT - dims.edgeArcPadding;
  const startAngle: ArcAngle = sign > 0 ? 270 : 180;
  const endAngle: ArcAngle = sign > 0 ? 0 : 270;
  return (
    <>
      <line
        x1={edgeX}
        y1={ROW_HEIGHT - dims.edgeArcPadding}
        x2={edgeX}
        y2={ROW_HEIGHT}
        stroke={color}
        stroke-width={dims.lineWidth}
      />
      <path
        d={arcPath(arcCx, arcCy, startAngle, endAngle, dims)}
        stroke={color}
        fill="none"
        stroke-width={dims.lineWidth}
      />
      <line
        x1={arcCx}
        y1={ROW_HEIGHT / 2}
        x2={nodeX}
        y2={ROW_HEIGHT / 2}
        stroke={color}
        stroke-width={dims.lineWidth}
      />
    </>
  );
}

export function renderEndingEdge(
  edgeCol: number,
  nodeCol: number,
  dims: RenderDims,
) {
  const edgeX = laneCenterX(edgeCol, dims);
  const color = laneColor(edgeCol);
  if (edgeCol === nodeCol) {
    return (
      <line
        x1={edgeX}
        y1={0}
        x2={edgeX}
        y2={ROW_HEIGHT / 2}
        stroke={color}
        stroke-width={dims.lineWidth}
      />
    );
  }
  const nodeX = laneCenterX(nodeCol, dims);
  const sign = nodeX > edgeX ? 1 : -1;
  const h = sign * dims.edgeArcApproach;
  const arcCx = edgeX + h;
  const arcCy = dims.edgeArcPadding;
  const startAngle: ArcAngle = sign > 0 ? 0 : 90;
  const endAngle: ArcAngle = sign > 0 ? 90 : 180;
  return (
    <>
      <line
        x1={edgeX}
        y1={0}
        x2={edgeX}
        y2={dims.edgeArcPadding}
        stroke={color}
        stroke-width={dims.lineWidth}
      />
      <path
        d={arcPath(arcCx, arcCy, startAngle, endAngle, dims)}
        stroke={color}
        fill="none"
        stroke-width={dims.lineWidth}
      />
      <line
        x1={arcCx}
        y1={ROW_HEIGHT / 2}
        x2={nodeX}
        y2={ROW_HEIGHT / 2}
        stroke={color}
        stroke-width={dims.lineWidth}
      />
    </>
  );
}
