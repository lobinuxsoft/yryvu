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

import { createSignal, For, Show } from "solid-js";

import type { GraphRow } from "../../ipc";
import type { RowEdges } from "./edgeStates";

/**
 * Per-email cache of avatar load results. Prevents reissuing network
 * requests for emails that already 404'd on Gravatar (there's no point
 * trying again within a session — Gravatar caches aggressively and a
 * missing avatar on page 1 stays missing on page 40). Bound to an
 * upper ceiling so long-history repos don't leak; simple FIFO eviction
 * is sufficient — ordering within the cache doesn't matter for
 * correctness.
 *
 * `true`  → we've seen a 404 / network error for this email
 * `false` → we've successfully loaded the avatar
 * absent  → not tried yet (render optimistically, cache the outcome)
 */
const AVATAR_CACHE_CAP = 512;
const avatarStatusByEmail = new Map<string, boolean>();
function rememberAvatarStatus(email: string, failed: boolean) {
  if (avatarStatusByEmail.size >= AVATAR_CACHE_CAP && !avatarStatusByEmail.has(email)) {
    // Evict the oldest insertion (Map iteration preserves insertion order in JS).
    const firstKey = avatarStatusByEmail.keys().next().value;
    if (firstKey !== undefined) avatarStatusByEmail.delete(firstKey);
  }
  avatarStatusByEmail.set(email, failed);
}

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
 * Author avatar overlay for a non-merge commit node. Renders a lane-color
 * backdrop + circular-clipped `<image>` over the commit circle. On image
 * load failure (404 / offline / blocked) falls back to a two-letter
 * initials badge with the lane's color as background, matching
 * GitKraken's `getDefaultAvatar` fallback.
 *
 * - Gravatar URL composed from the pre-hashed email (`row.gravatar_hash`).
 *   `d=404` forces Gravatar to 404 when no avatar is registered, so the
 *   onerror path runs instead of getting the default "mystery man" image.
 * - Per-email result cached across all rows (see `avatarStatusByEmail`)
 *   — a second commit by the same author reuses the previous outcome
 *   and skips the image fetch entirely when it already failed.
 */
function CommitAvatar(props: {
  cx: number;
  cy: number;
  radius: number;
  colorIdx: number;
  authorEmail: string;
  authorInitials: string;
  gravatarHash: string;
}) {
  const cached = avatarStatusByEmail.get(props.authorEmail);
  // `loaded` flips to true on the image element's `load` event. The image
  // starts at opacity 0; if it loads successfully we swap to opacity 1
  // (tapping over the text initials). If it fails — 404, offline, blocked —
  // opacity stays 0 forever and the text stays visible. This sidesteps SVG
  // `onerror` which fires inconsistently across engines / Tauri's WebView.
  const [loaded, setLoaded] = createSignal(cached === false);
  // Resolve the avatar URL, preferring provider-native sources where the
  // email identifies the user unambiguously:
  //
  // 1. **GitHub noreply** — `<id>+<username>@users.noreply.github.com` or
  //    `<username>@users.noreply.github.com` (legacy). Extract the
  //    username and hit `https://github.com/<user>.png?size=N` which
  //    redirects to the real avatar on `avatars.githubusercontent.com`.
  //    No auth / API quota — works as long as the username is public.
  // 2. **Gravatar** — derived from the pre-hashed email. `d=404` so
  //    Gravatar returns 404 when no avatar is registered, letting the
  //    image's load/error pair land on the initials fallback cleanly
  //    instead of loading Gravatar's default mystery-man.
  const avatarUrl = () => {
    const size = props.radius * 4;
    const m = /^(?:\d+\+)?([^@\s]+)@users\.noreply\.github\.com$/i.exec(
      props.authorEmail,
    );
    if (m && m[1]) {
      return `https://github.com/${m[1]}.png?size=${size}`;
    }
    return `https://gravatar.com/avatar/${props.gravatarHash}?s=${size}&d=404`;
  };
  const bgColor = () => laneColor(props.colorIdx);
  const fontSize = () => `${Math.round(props.radius * 0.95)}px`;
  // Suppress the network request altogether for emails whose avatar
  // already 404'd earlier in the session — saves a useless round-trip.
  const shouldTryImage = () => cached !== true;
  // Two concentric rings separate the avatar from the lane-color backdrop
  // so an avatar whose dominant hue matches the lane doesn't dissolve into
  // it (GitKraken doc 16 reference — visible as a 1-px dark frame around
  // every avatar in their graph). Outer lane-color ring is 1 px wide,
  // inner dark ring is 1 px, avatar is inset by 2 px total from the commit
  // circle's radius.
  const innerRingRadius = () => Math.max(props.radius - 1, 0);
  const avatarRadius = () => Math.max(props.radius - 2, 0);
  return (
    <>
      {/* Outer lane-color disc — forms the 1-px lane-color frame around
          the avatar. */}
      <circle cx={props.cx} cy={props.cy} r={props.radius} fill={bgColor()} />
      {/* Dark separator ring — 1 px, app background colour. Keeps the
          avatar legible when its dominant hue is close to the lane tint
          (the darker gap gives the eye an edge to latch onto). */}
      <circle
        cx={props.cx}
        cy={props.cy}
        r={innerRingRadius()}
        fill="var(--bg-0)"
      />
      {/* Initials text painted unconditionally. The image (below) overlays
          it when loaded; otherwise this shows through as the fallback. */}
      <text
        x={props.cx}
        y={props.cy}
        font-size={fontSize()}
        font-weight="600"
        text-anchor="middle"
        dominant-baseline="central"
        fill="#fff"
        style={{ "user-select": "none", "pointer-events": "none" }}
      >
        {props.authorInitials}
      </text>
      <Show when={shouldTryImage()}>
        <image
          href={avatarUrl()}
          x={props.cx - avatarRadius()}
          y={props.cy - avatarRadius()}
          width={avatarRadius() * 2}
          height={avatarRadius() * 2}
          preserveAspectRatio="xMidYMid slice"
          style={{
            opacity: loaded() ? 1 : 0,
            transition: "opacity 120ms ease-out",
            // CSS clip-path with percentages — relative to the image's
            // own bounding box. Works across every SVG2 renderer; avoids
            // the SVG-attribute `clip-path: circle(Npx at ...)` form
            // which older WebKit treats as invalid syntax.
            "clip-path": "circle(50% at 50% 50%)",
          }}
          on:load={() => {
            rememberAvatarStatus(props.authorEmail, false);
            setLoaded(true);
          }}
          on:error={() => {
            rememberAvatarStatus(props.authorEmail, true);
          }}
        />
      </Show>
    </>
  );
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

      {/* Commit node — painted last so it sits atop any horizontal that
          reaches into its column at midY.
          - Merges: a plain lane-color disc at the smaller merge radius.
            GitKraken's product decision is to skip the avatar on merge
            commits (doc 16 / bundle `GraphAvatar` props).
          - Regular commits: lane-color backdrop + Gravatar image with
            initials fallback, via `CommitAvatar`. */}
      <Show
        when={!props.row.is_merge}
        fallback={
          <circle
            cx={laneCenterX(props.row.lane)}
            cy={midY}
            r={radius()}
            fill={commitColor()}
          />
        }
      >
        <CommitAvatar
          cx={laneCenterX(props.row.lane)}
          cy={midY}
          radius={radius()}
          colorIdx={props.row.color_idx}
          authorEmail={props.row.author_email}
          authorInitials={props.row.author_initials}
          gravatarHash={props.row.gravatar_hash}
        />
      </Show>
    </svg>
  );
}

export { ROW_HEIGHT, LANE_WIDTH, GUTTER, COMMIT_RADIUS, MERGE_RADIUS };
