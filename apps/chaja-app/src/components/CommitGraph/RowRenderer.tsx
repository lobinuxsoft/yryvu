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

import type { GraphRow, HostingService } from "../../ipc";
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
const PALETTE_SIZE = 10;

/**
 * Resolve the best avatar URL for an author email. Shared by the
 * SVG `CommitAvatar` (graph zone) and the HTML `AuthorBadge` (author
 * column icon-only mode) so the same image gets cache-hit by the
 * browser the second time around.
 *
 * Provider preference matches GK (`getAvatarFromEmail`, app bundle):
 *   1. github CDN email endpoint when the repo's primary remote is GH;
 *   2. github noreply email → `github.com/<user>.png`;
 *   3. gravatar with `d=404` so misses fall back to initials.
 */
export function resolveAvatarUrl(
  email: string,
  gravatarHash: string,
  hostingService: HostingService,
  diameterPx: number,
): string {
  if (hostingService === "github") {
    return `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(
      email,
    )}&s=${diameterPx}`;
  }
  const noreply = /^(?:\d+\+)?([^@\s]+)@users\.noreply\.github\.com$/i.exec(email);
  if (noreply && noreply[1]) {
    return `https://github.com/${noreply[1]}.png?size=${diameterPx}`;
  }
  return `https://gravatar.com/avatar/${gravatarHash}?s=${diameterPx}&d=404`;
}

/**
 * HTML-friendly author avatar badge — used by the Author column in
 * icon-only mode. Mirrors `CommitAvatar`'s URL resolution and 404
 * cache so the image is loaded once per email and reused everywhere.
 */
export function AuthorBadge(props: {
  authorEmail: string;
  authorInitials: string;
  gravatarHash: string;
  hostingService: HostingService;
  colorIdx: number;
}) {
  const cached = avatarStatusByEmail.get(props.authorEmail);
  const [loaded, setLoaded] = createSignal(cached === false);
  const url = () =>
    resolveAvatarUrl(props.authorEmail, props.gravatarHash, props.hostingService, 44);
  return (
    <span
      class="author-badge"
      style={{
        background: `var(--column-${props.colorIdx % PALETTE_SIZE}-color)`,
      }}
    >
      <span class="author-badge__initials">{props.authorInitials}</span>
      <Show when={cached !== true}>
        <img
          class="author-badge__img"
          src={url()}
          alt=""
          style={{ opacity: loaded() ? 1 : 0 }}
          onLoad={() => {
            rememberAvatarStatus(props.authorEmail, false);
            setLoaded(true);
          }}
          onError={() => {
            rememberAvatarStatus(props.authorEmail, true);
          }}
        />
      </Show>
    </span>
  );
}

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


// GK's `eC`/`eT` lookup tables: angle (degrees) → cos/sin. Convention:
// 0=LEFT, 90=DOWN, 180=RIGHT, 270=UP (y grows down in SVG).
const COS_TABLE: Record<number, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN_TABLE: Record<number, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };

type ArcAngle = 0 | 90 | 180 | 270;

function laneCenterX(lane: number, dims: RenderDims): number {
  return dims.gutter + lane * dims.laneWidth + dims.laneWidth / 2;
}

function laneColor(col: number): string {
  return `var(--column-${col % PALETTE_SIZE}-color)`;
}

/** GK's `eE(e, t, o)`: arc endpoint + straight-line-padding offset for a
 *  cardinal angle on a circle of radius `dims.edgeArcApproach` at (cx, cy). */
function arcEndpoint(cx: number, cy: number, angle: ArcAngle, dims: RenderDims) {
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
function arcPath(
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

export interface CommitRowGraphProps {
  row: GraphRow;
  edges: RowEdges;
  hostingService: HostingService;
  /** When `true`, render with the compact dimension preset (smaller
   *  lanes + nodes). Mirrors GK's `commitZone.mode === Compact`. */
  compact: boolean;
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
  hostingService: HostingService;
}) {
  const cached = avatarStatusByEmail.get(props.authorEmail);
  // `loaded` flips to true on the image element's `load` event. The image
  // starts at opacity 0; if it loads successfully we swap to opacity 1
  // (tapping over the text initials). If it fails — 404, offline, blocked —
  // opacity stays 0 forever and the text stays visible. This sidesteps SVG
  // `onerror` which fires inconsistently across engines / Tauri's WebView.
  const [loaded, setLoaded] = createSignal(cached === false);
  // Resolve the avatar URL, preferring provider-native sources where the
  // repo's hosting service identifies a CDN that resolves email → avatar
  // without API auth. Direct port of GitKraken's `getAvatarFromEmail`
  // (app bundle offset 1508073):
  //
  // 1. **GitHub CDN** (`hostingService === "github"`) — hit
  //    `https://avatars.githubusercontent.com/u/e?email=<email>&s=N`.
  //    This is a CDN endpoint (NOT the API), no auth required, no rate
  //    limit, and GitHub resolves the email against its internal user
  //    database. If no user matches, it returns an identicon (not a 404)
  //    so the initials fallback won't trigger — acceptable: we show an
  //    identicon instead of a letter badge, same as GK.
  // 2. **GitHub noreply email** (any hosting service) — `[id+]user@users
  //    .noreply.github.com`. Extract the username, hit
  //    `https://github.com/<user>.png?size=N` which redirects to the
  //    real avatar. Works even when the repo's main remote isn't
  //    GitHub (e.g., mirrored to GitLab but commits still use GitHub
  //    noreply emails).
  // 3. **Gravatar** — the hash is pre-computed server-side. `d=404`
  //    forces Gravatar to 404 on missing avatars so the initials
  //    fallback shows instead of the default mystery-man.
  const avatarUrl = () => {
    const size = props.radius * 4;
    if (props.hostingService === "github") {
      return `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(
        props.authorEmail,
      )}&s=${size}`;
    }
    const noreply =
      /^(?:\d+\+)?([^@\s]+)@users\.noreply\.github\.com$/i.exec(
        props.authorEmail,
      );
    if (noreply && noreply[1]) {
      return `https://github.com/${noreply[1]}.png?size=${size}`;
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
function renderPassThrough(col: number, dims: RenderDims) {
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

function renderStartingEdge(edgeCol: number, nodeCol: number, dims: RenderDims) {
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

function renderEndingEdge(edgeCol: number, nodeCol: number, dims: RenderDims) {
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

export function CommitRowGraph(props: CommitRowGraphProps) {
  const dims = () => getRenderDims(props.compact);
  const midY = ROW_HEIGHT / 2;
  const radius = () =>
    props.row.is_merge ? dims().mergeRadius : dims().commitRadius;
  const commitColor = () => laneColor(props.row.color_idx);
  const isHeadRow = () => props.row.refs.some((r) => r.kind === "Head");
  const hasRefs = () => props.row.refs.length > 0;

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
  const svgWidth = () => laneCenterX(maxLane(), dims()) + dims().commitRadius + 4;

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

export { ROW_HEIGHT };
