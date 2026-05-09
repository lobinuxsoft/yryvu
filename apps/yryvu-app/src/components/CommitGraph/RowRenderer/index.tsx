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
 * Geometry helpers (`laneCenterX` / `arcPath` / etc.) live in
 * `geometry.ts`; render dimensions in `dims.ts`; avatar URL resolution
 * + `AuthorBadge` HTML component in `avatar.tsx`; SVG `CommitAvatar` in
 * `CommitAvatar.tsx`; the three edge-shape primitives in `edges.tsx`.
 * This file composes them.
 */

import { For, Show } from "solid-js";

import type { GraphRow, HostingService } from "../../../ipc";
import type { RowEdgeCell, RowEdges } from "../edgeStates";
import { CommitAvatar } from "./CommitAvatar";
import { getRenderDims } from "./dims";
import {
  renderEndingEdge,
  renderPassThrough,
  renderStartingEdge,
} from "./edges";
import { laneCenterX, laneColor, ROW_HEIGHT } from "./geometry";

export { AuthorBadge, resolveAvatarUrl } from "./avatar";
export { getRenderDims, type RenderDims } from "./dims";
export { ROW_HEIGHT };

export interface CommitRowGraphProps {
  row: GraphRow;
  edges: RowEdges;
  hostingService: HostingService;
  /** When `true`, render with the compact dimension preset (smaller
   *  lanes + nodes). Mirrors GK's `commitZone.mode === Compact`. */
  compact: boolean;
}

export function CommitRowGraph(props: CommitRowGraphProps) {
  const dims = () => getRenderDims(props.compact);
  const midY = ROW_HEIGHT / 2;
  const radius = () =>
    props.row.is_merge ? dims().mergeRadius : dims().commitRadius;
  const commitColor = () => laneColor(props.row.color_idx);
  const isHeadRow = () => props.row.refs.some((r) => r.kind === "Head");
  const hasRefs = () => props.row.refs.length > 0;

  const sortedEdges = () => {
    const entries: [number, RowEdgeCell][] = [];
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
  const svgWidth = () =>
    laneCenterX(maxLane(), dims()) + dims().commitRadius + 4;

  return (
    <svg
      class="graph-row__svg"
      width={svgWidth()}
      height={ROW_HEIGHT}
      aria-hidden="true"
    >
      <Show when={hasRefs()}>
        <line
          x1={0}
          y1={midY}
          x2={laneCenterX(props.row.lane, dims()) - radius()}
          y2={midY}
          stroke={commitColor()}
          stroke-width={isHeadRow() ? 2 : 1}
          stroke-opacity={isHeadRow() ? 1 : 0.25}
        />
      </Show>
      <For each={sortedEdges()}>
        {([col, cell]) => (
          <>
            <Show when={cell.starting}>
              {renderStartingEdge(col, props.row.lane, dims())}
            </Show>
            <Show when={cell.passThrough}>
              {renderPassThrough(col, dims())}
            </Show>
            <Show when={cell.ending}>
              {renderEndingEdge(col, props.row.lane, dims())}
            </Show>
          </>
        )}
      </For>
      <Show
        when={!props.row.is_merge}
        fallback={
          <circle
            cx={laneCenterX(props.row.lane, dims())}
            cy={midY}
            r={radius()}
            fill={commitColor()}
          />
        }
      >
        <CommitAvatar
          cx={laneCenterX(props.row.lane, dims())}
          cy={midY}
          radius={radius()}
          colorIdx={props.row.color_idx}
          authorEmail={props.row.author_email}
          authorInitials={props.row.author_initials}
          gravatarHash={props.row.gravatar_hash}
          hostingService={props.hostingService}
        />
      </Show>
    </svg>
  );
}
