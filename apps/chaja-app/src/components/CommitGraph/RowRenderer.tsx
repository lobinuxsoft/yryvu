// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-row SVG graph renderer — 1:1 port of GitKraken's edge render loop
 * from `@gitkraken/gitkraken-components/dist/index.js` (inner loop at
 * bundle offset ~242000, deminified here for reference):
 *
 * ```js
 * for (let a = 0; a <= edgeColumnMax; a += 1) {
 *   let { starting, passThrough, ending } = edges[a] ?? {};
 *   c += starting    ? startingEdgeFn(color[a], a, parent.column, ...) : "";
 *   c += passThrough ? passThroughEdgeFn(a, ...)                        : "";
 *   c += ending      ? endingEdgeFn(color[a], a, commit.column, ...)    : "";
 * }
 * ```
 *
 * The `edges` dict is built by `edgeStates.ts` via GK's two-step pipeline:
 * propagate previous-row live edges, then layer the current commit's
 * parent starting-edges on top.
 *
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
 *
 * Arc geometry uses GK's cardinal-angle lookup trick (`eE`/`eI`) — see
 * `arcEndpoint` / `arcPath` below.
 */

import { For, Show } from "solid-js";

import type { GraphRow } from "../../ipc";
import type { RowEdges } from "./edgeStates";

const ROW_HEIGHT = 28;
const LANE_WIDTH = 22;
const GUTTER = 28;
const COMMIT_RADIUS = 11;
const MERGE_RADIUS = 6;
const EDGE_ARC_APPROACH = 11;
const EDGE_ARC_PADDING = 3;
const ARC_RADIUS = EDGE_ARC_APPROACH - EDGE_ARC_PADDING;
const PALETTE_SIZE = 10;

// GK's `eC`/`eT` lookup tables: angle (degrees) → cos/sin. Convention:
// 0=LEFT, 90=DOWN, 180=RIGHT, 270=UP (y grows down in SVG).
const COS_TABLE: Record<number, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN_TABLE: Record<number, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };

type ArcAngle = 0 | 90 | 180 | 270;

function laneCenterX(lane: number): number {
  return GUTTER + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function laneColor(col: number): string {
  return `var(--column-${col % PALETTE_SIZE}-color)`;
}

/** GK's `eE(e, t, o)`: arc endpoint + straight-line-padding offset for a
 *  cardinal angle on a circle of radius `EDGE_ARC_APPROACH` at (cx, cy). */
function arcEndpoint(cx: number, cy: number, angle: ArcAngle) {
  const cosA = COS_TABLE[angle];
  const sinA = SIN_TABLE[angle];
  return {
    x: cx - EDGE_ARC_APPROACH * cosA,
    y: cy + EDGE_ARC_APPROACH * sinA,
    xOffset: -(cosA * EDGE_ARC_PADDING),
    yOffset: sinA * EDGE_ARC_PADDING,
  };
}

/** GK's `eI(e, t, o, r, i, n, s, l)` inner path-builder: quarter-arc with
 *  straight-line padding on each side. `cx, cy` is the elbow's turn point. */
function arcPath(
  cx: number,
  cy: number,
  startAngle: ArcAngle,
  endAngle: ArcAngle,
): string {
  const s = arcEndpoint(cx, cy, startAngle);
  const l = arcEndpoint(cx, cy, endAngle);
  const leadIn =
    l.xOffset !== 0 ? `H ${s.x + l.xOffset}` : `V ${s.y + l.yOffset}`;
  const leadOut = s.xOffset !== 0 ? `H ${l.x}` : `V ${l.y}`;
  return `M ${s.x} ${s.y} ${leadIn} A ${ARC_RADIUS} ${ARC_RADIUS} 0 0 0 ${
    l.x + s.xOffset
  } ${l.y + s.yOffset} ${leadOut}`;
}

export interface CommitRowGraphProps {
  row: GraphRow;
  edges: RowEdges;
}

/**
 * Shape for a single cross-column or same-column edge. Rendered as 1–3
 * primitive SVG elements concatenated inside a SolidJS fragment; no
 * grouping `<g>` wrapper because the DOM layering is already correct via
 * append order.
 */
function renderPassThrough(col: number) {
  const x = laneCenterX(col);
  return (
    <line
      x1={x}
      y1={0}
      x2={x}
      y2={ROW_HEIGHT}
      stroke={laneColor(col)}
      stroke-width="2"
    />
  );
}

function renderStartingEdge(edgeCol: number, nodeCol: number) {
  const edgeX = laneCenterX(edgeCol);
  const color = laneColor(edgeCol);
  if (edgeCol === nodeCol) {
    // Same-column — simple bottom-half vertical at commit's lane.
    return (
      <line
        x1={edgeX}
        y1={ROW_HEIGHT / 2}
        x2={edgeX}
        y2={ROW_HEIGHT}
        stroke={color}
        stroke-width="2"
      />
    );
  }
  // Cross-column L-shape (merge extra parent): edge leaves commit at
  // midY, arcs over to the parent's column at the row's bottom.
  const nodeX = laneCenterX(nodeCol);
  const sign = nodeX > edgeX ? 1 : -1;
  const h = sign * EDGE_ARC_APPROACH;
  const arcCx = edgeX + h;
  const arcCy = ROW_HEIGHT - EDGE_ARC_PADDING;
  // GK's literal table at bundle offset 242611:
  //   t<o → start=180, end=270   (commit LEFT of edge, sign<0)
  //   t>o → start=270, end=  0   (commit RIGHT of edge, sign>0)
  // `t` is nodeCol in the calling convention; `o` is edgeCol.
  const startAngle: ArcAngle = sign > 0 ? 270 : 180;
  const endAngle: ArcAngle = sign > 0 ? 0 : 270;
  return (
    <>
      <line
        x1={edgeX}
        y1={ROW_HEIGHT - EDGE_ARC_PADDING}
        x2={edgeX}
        y2={ROW_HEIGHT}
        stroke={color}
        stroke-width="2"
      />
      <path
        d={arcPath(arcCx, arcCy, startAngle, endAngle)}
        stroke={color}
        fill="none"
        stroke-width="2"
      />
      <line
        x1={arcCx}
        y1={ROW_HEIGHT / 2}
        x2={nodeX}
        y2={ROW_HEIGHT / 2}
        stroke={color}
        stroke-width="2"
      />
    </>
  );
}

function renderEndingEdge(edgeCol: number, nodeCol: number) {
  const edgeX = laneCenterX(edgeCol);
  const color = laneColor(edgeCol);
  if (edgeCol === nodeCol) {
    // Same-column — simple top-half vertical at commit's lane.
    return (
      <line
        x1={edgeX}
        y1={0}
        x2={edgeX}
        y2={ROW_HEIGHT / 2}
        stroke={color}
        stroke-width="2"
      />
    );
  }
  // Cross-column L-shape (first-parent at different lane): edge enters
  // at row top in the descendant's (edge) column, arcs over to midY at
  // the parent commit's column.
  const nodeX = laneCenterX(nodeCol);
  const sign = nodeX > edgeX ? 1 : -1;
  const h = sign * EDGE_ARC_APPROACH;
  const arcCx = edgeX + h;
  const arcCy = EDGE_ARC_PADDING;
  // GK's literal table at bundle offset 243347:
  //   t>o → start=  0, end=90    (commit RIGHT of edge, sign>0)
  //   t<o → start= 90, end=180   (commit LEFT of edge, sign<0)
  const startAngle: ArcAngle = sign > 0 ? 0 : 90;
  const endAngle: ArcAngle = sign > 0 ? 90 : 180;
  return (
    <>
      <line
        x1={edgeX}
        y1={0}
        x2={edgeX}
        y2={EDGE_ARC_PADDING}
        stroke={color}
        stroke-width="2"
      />
      <path
        d={arcPath(arcCx, arcCy, startAngle, endAngle)}
        stroke={color}
        fill="none"
        stroke-width="2"
      />
      <line
        x1={arcCx}
        y1={ROW_HEIGHT / 2}
        x2={nodeX}
        y2={ROW_HEIGHT / 2}
        stroke={color}
        stroke-width="2"
      />
    </>
  );
}

export function CommitRowGraph(props: CommitRowGraphProps) {
  const midY = ROW_HEIGHT / 2;
  const radius = () =>
    props.row.is_merge ? MERGE_RADIUS : COMMIT_RADIUS;
  const commitColor = () => laneColor(props.row.color_idx);

  const sortedEdges = () => {
    const entries: [number, import("./edgeStates").RowEdgeCell][] = [];
    props.edges.forEach((cell, col) => entries.push([col, cell]));
    entries.sort((a, b) => a[0] - b[0]);
    return entries;
  };

  const maxLane = () => {
    let max = props.row.lane;
    props.edges.forEach((_cell, col) => {
      if (col > max) max = col;
    });
    for (const pl of props.row.parent_lanes) if (pl > max) max = pl;
    return max;
  };
  const svgWidth = () => laneCenterX(maxLane()) + COMMIT_RADIUS + 4;

  return (
    <svg
      class="graph-row__svg"
      width={svgWidth()}
      height={ROW_HEIGHT}
      aria-hidden="true"
    >
      {/* Per-column dispatch — exact GK loop: starting, then passThrough,
          then ending at each column. Column ascending so layering is
          deterministic across rows. */}
      <For each={sortedEdges()}>
        {([col, cell]) => (
          <>
            <Show when={cell.starting}>
              {renderStartingEdge(col, props.row.lane)}
            </Show>
            <Show when={cell.passThrough}>
              {renderPassThrough(col)}
            </Show>
            <Show when={cell.ending}>
              {renderEndingEdge(col, props.row.lane)}
            </Show>
          </>
        )}
      </For>

      {/* Commit circle — painted last so it sits atop any horizontal
          that reaches into its column at midY. */}
      <circle
        cx={laneCenterX(props.row.lane)}
        cy={midY}
        r={radius()}
        fill={commitColor()}
      />
    </svg>
  );
}

export { ROW_HEIGHT, LANE_WIDTH, GUTTER, COMMIT_RADIUS, MERGE_RADIUS };
