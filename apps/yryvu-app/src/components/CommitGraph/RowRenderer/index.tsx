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
import {
  highlightedSha,
  prsByHeadSha,
  recentlyCreatedSha,
  selectedShas,
} from "../../../state";
import type { RowEdgeCell, RowEdges } from "../edgeStates";
import { CommitAvatar } from "./CommitAvatar";
import { getRenderDims } from "./dims";
import {
  renderEndingEdge,
  renderPassThrough,
  renderStartingEdge,
} from "./edges";
import { laneCenterX, laneColor, ROW_HEIGHT } from "./geometry";
import {
  AnimationWrapper,
  HoverHalo,
  InitialCommitOutline,
  MergeRing,
  PrAttributionIcon,
  SelectionRing,
  StashGlyph,
  TagStar,
} from "./NodeOverlays";

export { AuthorBadge, resolveAvatarUrl } from "./avatar";
export { getRenderDims, hydrateGraphDims, type RenderDims } from "./dims";
export { ROW_HEIGHT };

export interface CommitRowGraphProps {
  row: GraphRow;
  edges: RowEdges;
  hostingService: HostingService;
  /** When `true`, render with the compact dimension preset (smaller
   *  lanes + nodes). Mirrors GK's `commitZone.mode === Compact`. */
  compact: boolean;
  /** Forwarded from the zone — drives the hover halo. */
  isHovered?: boolean;
}

/// 18 px minimum vertical budget before the avatar overlay renders
/// (GK doc 16). Compact modes that bring `ROW_HEIGHT` below this
/// would fall back to a plain lane disc.
const AVATAR_MIN_HEIGHT_PX = 18;

export function CommitRowGraph(props: CommitRowGraphProps) {
  const dims = () => getRenderDims(props.compact);
  const midY = ROW_HEIGHT / 2;
  const isStash = () => props.row.node_type === "Stash";
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
              {renderStartingEdge(col, props.row.lane, dims(), isStash())}
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
      {renderNodeWithOverlays(props, dims, midY, radius, commitColor)}
    </svg>
  );
}

function renderNodeWithOverlays(
  props: CommitRowGraphProps,
  dims: () => ReturnType<typeof getRenderDims>,
  midY: number,
  radius: () => number,
  commitColor: () => string,
) {
  const cx = () => laneCenterX(props.row.lane, dims());
  const isMerge = () => props.row.is_merge;
  const isStash = () => props.row.node_type === "Stash";
  // GraphRow only holds real commits — the WIP pseudo-row is injected
  // by `GraphZone` as a separate `<li>` and never reaches this
  // renderer, so an `is_wip` check here would be dead. Initial-commit
  // detection therefore relies on `parent_lanes` alone.
  const isInitial = () => props.row.parent_lanes.length === 0;
  const tagPresent = () => props.row.refs.some((r) => r.kind === "Tag");
  const pr = () => prsByHeadSha()?.get(props.row.sha);
  const isSelected = () => selectedShas().includes(props.row.sha);
  const showAvatar = () => !isMerge() && ROW_HEIGHT >= AVATAR_MIN_HEIGHT_PX;

  return (
    <AnimationWrapper
      row={props.row}
      recentlyCreated={recentlyCreatedSha() === props.row.sha}
      highlighted={highlightedSha() === props.row.sha}
      laneColor={commitColor()}
      cx={cx()}
      cy={midY}
      radius={radius()}
    >
      {/* Layer 8 — paint before the node so the halo sits underneath. */}
      <Show when={props.isHovered}>
        <HoverHalo
          cx={cx()}
          cy={midY}
          radius={radius()}
          laneColor={commitColor()}
        />
      </Show>

      {/* Layers 1+2+3 — lane circle + merge ring + avatar.
          Stash nodes (issue #171) replace the whole circle/merge-ring
          stack with a rounded-rectangle glyph so they read as distinct
          at a glance. Tag/PR/selection overlays below still apply. */}
      <Show
        when={!isStash()}
        fallback={
          <StashGlyph
            cx={cx()}
            cy={midY}
            radius={radius()}
            laneColor={commitColor()}
            message={props.row.summary}
          />
        }
      >
        <Show
          when={!isMerge()}
          fallback={
            <MergeRing
              cx={cx()}
              cy={midY}
              radius={radius()}
              laneColor={commitColor()}
            />
          }
        >
          <Show
            when={showAvatar()}
            fallback={
              <circle cx={cx()} cy={midY} r={radius()} fill={commitColor()} />
            }
          >
            <CommitAvatar
              cx={cx()}
              cy={midY}
              radius={radius()}
              colorIdx={props.row.color_idx}
              authorEmail={props.row.author_email}
              authorInitials={props.row.author_initials}
              gravatarHash={props.row.gravatar_hash}
              hostingService={props.hostingService}
            />
          </Show>
          <Show when={isInitial()}>
            <InitialCommitOutline
              cx={cx()}
              cy={midY}
              radius={radius()}
              laneColor={commitColor()}
            />
          </Show>
        </Show>
      </Show>

      {/* Layer 4 (conflict triangle) lives on the WIP pseudo-row in
          GraphZone, not here — real commits never hold conflict
          state. See `commit-graph__wip-cell--graph`. */}

      {/* Layer 5 — PR attribution. */}
      <Show when={pr()}>
        <PrAttributionIcon
          cx={cx()}
          cy={midY}
          radius={radius()}
          laneColor={commitColor()}
          pr={pr()!}
        />
      </Show>

      {/* Layer 6 — tag star. */}
      <Show when={tagPresent()}>
        <TagStar
          cx={cx()}
          cy={midY}
          radius={radius()}
          laneColor={commitColor()}
        />
      </Show>

      {/* Layer 7 — selection ring outside everything. */}
      <Show when={isSelected()}>
        <SelectionRing
          cx={cx()}
          cy={midY}
          radius={radius()}
          laneColor={commitColor()}
        />
      </Show>
    </AnimationWrapper>
  );
}
