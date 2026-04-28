// SPDX-License-Identifier: AGPL-3.0-or-later

import { For } from "solid-js";

import { ROW_HEIGHT } from "./RowRenderer";

/**
 * Placeholder rows shown while `streamGraph` hasn't yet emitted a single
 * batch. The pre-batch pipeline (gix walk + collect + topo sort + lane
 * allocator) blocks for several seconds on big repos like `eggscape`
 * (~645 commits, ~640 remote branches) — the user used to see a static
 * `Loading…` line, which read as a frozen app. This band makes the
 * waiting time visible and shaped instead of blank (issue #180).
 *
 * The skeleton overlays the zones container at top:0 so it doesn't
 * fight the vertical scroll virtualizer (which mounts no rows yet).
 * Geometry mirrors `RowRenderer.tsx` ROW_HEIGHT so the column doesn't
 * reflow when real rows replace the placeholders.
 *
 * Each row carries a fake graph node + connector + variable-width
 * message bar + author / date / sha bars. Lane offsets and widths
 * follow deterministic patterns keyed on row index so HMR reloads and
 * screenshot diffs stay stable.
 *
 * Backend streaming optimisation is tracked separately as #181 — this
 * component is the UX-side complement that masks the wait until then.
 */

const ROW_COUNT = 12;

const LANE_PATTERN: readonly number[] = [
  0, 1, 0, 2, 1, 0, 3, 1, 2, 0, 1, 0,
];

const MSG_WIDTH_PATTERN: readonly string[] = [
  "62%",
  "44%",
  "70%",
  "38%",
  "55%",
  "62%",
  "40%",
  "68%",
  "50%",
  "72%",
  "44%",
  "58%",
];

/** Lane width to mirror the GRAPH zone's lane spacing roughly (the
 *  exact value from `getRenderDims` is mode-dependent — we just need a
 *  visual cue, not pixel-perfect alignment, since the real rows replace
 *  the skeleton on the first batch). */
const LANE_WIDTH = 22;
const LANE_GUTTER = 28;

export function LoadingSkeleton(props: { topOffset?: number }) {
  return (
    <div
      class="commit-graph__skeleton"
      style={{ top: `${props.topOffset ?? 0}px` }}
      aria-busy="true"
      aria-label="Loading commit history"
    >
      <For each={Array.from({ length: ROW_COUNT }, (_, i) => i)}>
        {(i) => (
          <div
            class="commit-graph__skeleton-row"
            style={{ height: `${ROW_HEIGHT}px` }}
          >
            <span
              class="commit-graph__skeleton-node"
              style={{
                left: `${LANE_GUTTER + LANE_PATTERN[i] * LANE_WIDTH}px`,
              }}
            />
            <span
              class="commit-graph__skeleton-msg"
              style={{ width: MSG_WIDTH_PATTERN[i] }}
            />
            <span class="commit-graph__skeleton-author" />
            <span class="commit-graph__skeleton-sha" />
          </div>
        )}
      </For>
    </div>
  );
}
