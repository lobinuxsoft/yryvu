// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Commit-node overlay system (issue #53).
 *
 * Composes up to 9 layers per node (bottom→top): lane circle, merge
 * distinction, avatar, conflict triangle, PR attribution, tag star,
 * selection ring, hover halo, animation flash. See
 * `docs/research/gitkraken-graph/16-node-overlays.md` for the spec —
 * this file ports the GK overlay compositor 1:1.
 *
 * Layer 1 (lane circle) + Layer 3 (avatar) live in `CommitAvatar.tsx`
 * since they're inseparable from the node primitive. Layer 2 (merge
 * hollow ring) ships here. The remaining badge / ring / halo /
 * animation layers all live in this file as small predicate-driven
 * components that the caller (`CommitRowGraph`) composes in the
 * required paint order.
 */

import { type JSX, Show } from "solid-js";

import type { GraphRow, PullRequestSummary } from "../../../ipc";

/// GitHub-palette PR-state colors. Mirrored from GK doc 16 so glance
/// meaning transfers from the GitHub UI.
function prColor(pr: PullRequestSummary): string {
  if (pr.draft) return "#8b949e";
  switch (pr.state) {
    case "open":
      return "#3fb950";
    case "merged":
      return "#8957e5";
    case "closed":
      return "#da3633";
  }
}

function prTitle(pr: PullRequestSummary): string {
  const state = pr.draft ? "Draft" : pr.state;
  return `PR #${pr.number} (${state}): ${pr.title}`;
}

interface NodeBaseProps {
  cx: number;
  cy: number;
  radius: number;
  laneColor: string;
}

/// Layer 2 — merge commit hollow ring. Replaces the solid disc; the
/// caller's `<Show fallback>` decides which to paint.
export function MergeRing(props: NodeBaseProps): JSX.Element {
  return (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={props.radius}
      fill="var(--bg-0)"
      stroke={props.laneColor}
      stroke-width="1.5"
    />
  );
}

/// Layer 1/2 variant for stash entries (issue #171). Replaces the
/// circle/merge-ring with a storage-box glyph filled in the lane color:
/// a square body, a lid band across the top, and a short handle slot in
/// the lid centre. Reads as "something stowed away" rather than a generic
/// rounded rect. Lid/handle strokes use semi-transparent black so they
/// stay legible on any lane color. GK marks these `stash-node` in its
/// bundle (`:241969`).
interface StashGlyphProps extends NodeBaseProps {
  message?: string;
}

export function StashGlyph(props: StashGlyphProps): JSX.Element {
  const half = () => props.radius * 0.95;
  const x = () => props.cx - half();
  const y = () => props.cy - half();
  const side = () => half() * 2;
  // Lid band sits in the top third; the handle slot is centred within it.
  const lidY = () => y() + side() * 0.34;
  const handleHalf = () => side() * 0.18;
  const handleY = () => y() + side() * 0.17;
  const lineStroke = "rgba(0, 0, 0, 0.5)";
  return (
    <g>
      <Show when={props.message}>
        <title>Stash: {props.message}</title>
      </Show>
      <rect
        x={x()}
        y={y()}
        width={side()}
        height={side()}
        rx={2}
        ry={2}
        fill={props.laneColor}
      />
      {/* Lid separator across the full width. */}
      <line
        x1={x()}
        y1={lidY()}
        x2={x() + side()}
        y2={lidY()}
        stroke={lineStroke}
        stroke-width={1}
      />
      {/* Handle slot centred in the lid. */}
      <line
        x1={props.cx - handleHalf()}
        y1={handleY()}
        x2={props.cx + handleHalf()}
        y2={handleY()}
        stroke={lineStroke}
        stroke-width={1.4}
        stroke-linecap="round"
      />
    </g>
  );
}

/// Layer 2 — initial commit (no parent) gets a thin outline on top of
/// the solid lane disc so it visually distinguishes from regular
/// commits without changing the shape.
export function InitialCommitOutline(props: NodeBaseProps): JSX.Element {
  return (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={props.radius}
      fill="none"
      stroke="#00000022"
      stroke-width="1"
    />
  );
}

interface PrIconProps extends NodeBaseProps {
  pr: PullRequestSummary;
}

/// Layer 5 — PR attribution. Bottom-right 10×10 GitHub-palette badge
/// on the commit at the head of a branch with an open / draft /
/// merged / closed PR. Diagonally opposed to the tag star.
export function PrAttributionIcon(props: PrIconProps): JSX.Element {
  const cx = () => props.cx + props.radius * 0.7;
  const cy = () => props.cy + props.radius * 0.7;
  return (
    <g>
      <title>{prTitle(props.pr)}</title>
      <circle cx={cx()} cy={cy()} r={5} fill={prColor(props.pr)} />
      <circle cx={cx()} cy={cy()} r={5} fill="none" stroke="#000" stroke-width="0.5" />
    </g>
  );
}

/// Layer 6 — tag star. Upper-right 10×10 filled star on commits with
/// at least one annotated tag. Collision rule: conflict wins the slot.
export function TagStar(props: NodeBaseProps): JSX.Element {
  const cx = () => props.cx + props.radius * 0.7;
  const cy = () => props.cy - props.radius * 0.7;
  // 5-point star path centred at (cx, cy), radius ~5.
  const star = () => {
    const c = cx();
    const cy0 = cy();
    const r = 5;
    const inner = r * 0.4;
    const pts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : inner;
      const ang = (Math.PI / 2) + (i * Math.PI) / 5;
      const x = c + Math.cos(ang) * rad;
      const y = cy0 - Math.sin(ang) * rad;
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return `M ${pts[0]} L ${pts.slice(1).join(" L ")} Z`;
  };
  return (
    <g>
      <title>Tagged commit</title>
      <path d={star()} fill="#f1c40f" stroke="#000" stroke-width="0.5" />
    </g>
  );
}

/// Layer 7 — selection ring. Stroke-only circle outside the node.
export function SelectionRing(props: NodeBaseProps): JSX.Element {
  return (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={props.radius + 3}
      fill="none"
      stroke="var(--accent-1, #58a6ff)"
      stroke-width="2"
    />
  );
}

/// Layer 8 — hover halo. Soft outer glow. The caller paints this
/// BEFORE the lane circle in DOM order so the halo sits underneath.
export function HoverHalo(props: NodeBaseProps): JSX.Element {
  return (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={props.radius + 5}
      fill={props.laneColor}
      opacity="0.15"
      style={{ transition: "opacity 120ms ease-out" }}
    />
  );
}

interface AnimationWrapperProps {
  row: GraphRow;
  recentlyCreated: boolean;
  highlighted: boolean;
  laneColor: string;
  cx: number;
  cy: number;
  radius: number;
  children: JSX.Element;
}

/// Layer 9 — animation flash. `commitCreated` scales the node 1→1.25→1
/// over 400ms; `commitHighlight` flashes lane-color opacity 1→0.3→1
/// over 600ms. Merge commits do not animate on creation (GK product
/// decision); the WIP pseudo-row never reaches this renderer.
export function AnimationWrapper(props: AnimationWrapperProps): JSX.Element {
  const shouldPulse = () => props.recentlyCreated && !props.row.is_merge;
  return (
    <g
      classList={{
        "graph-node-anim": true,
        "graph-node-anim--created": shouldPulse(),
        "graph-node-anim--highlight": props.highlighted,
      }}
      style={{
        "transform-origin": `${props.cx}px ${props.cy}px`,
        "transform-box": "fill-box",
      }}
    >
      {props.children}
      {/* The highlight flash overlays a lane-color circle that pulses
          opacity. It paints AFTER the node so the underlying avatar
          stays the focal point — the flash is decoration, not the
          subject. */}
      <Show when={props.highlighted}>
        <circle
          class="graph-node-highlight-flash"
          cx={props.cx}
          cy={props.cy}
          r={props.radius + 2}
          fill={props.laneColor}
          opacity="0"
          style={{ "pointer-events": "none" }}
        />
      </Show>
    </g>
  );
}
