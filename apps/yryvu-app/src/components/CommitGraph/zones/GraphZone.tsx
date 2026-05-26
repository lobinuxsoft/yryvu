// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import {
  activeColumnSettings,
  commitZoneMode,
  dirtyFileCount,
  commitFilter,
  hasConflicts,
  hoveredRef,
  pathShaSet,
  inspectorMode,
  workdirSelected,
} from "../../../state";
import { isRowVisible } from "../hoverDim";
import { rowWrapperClass } from "../rowClass";
import { CommitRowGraph, getRenderDims, ROW_HEIGHT } from "../RowRenderer";
import { Tooltip } from "../../Tooltip";
import type { ZoneDeps } from "./types";

/**
 * GRAPH zone — the SVG lane chart with the WIP pseudo-node, the
 * dashed WIP-to-HEAD connector, the per-row tint anchored at the
 * commit circle, and the right-edge streak overlay (lane-coloured
 * strip pinned to the zone viewport even during horizontal pan).
 *
 * The horizontal scroll container nests INSIDE the zone so the
 * streaks overlay can be absolute-positioned against the zone's
 * viewport, not against the scrollable content (mirrors GK's
 * `RightGutter` pattern).
 */
export function GraphZone(props: { deps: ZoneDeps }) {
  const { deps } = props;
  return (
    <Show when={activeColumnSettings("graph").visible}>
      <div
        class="commit-graph__zone commit-graph__zone--graph"
        classList={{ "is-compact": commitZoneMode() === "compact" }}
        style={{ order: activeColumnSettings("graph").order }}
      >
        <div class="commit-graph__col-graph-hscroll">
          <ul
            class="commit-graph__col-graph"
            style={{
              height: `${deps.layout.totalHeight()}px`,
              "min-width": `${deps.layout.graphContentWidth()}px`,
            }}
          >
            <Show when={dirtyFileCount() > 0}>
              <Tooltip text="View working-directory changes">
              <li
                class="commit-graph__wip-cell commit-graph__wip-cell--graph"
                data-active={
                  workdirSelected() || inspectorMode() === "staging"
                    ? "true"
                    : "false"
                }
                style={{
                  top: "0px",
                  height: `${ROW_HEIGHT}px`,
                  "--wip-lane-color": `var(--column-${deps.layout.headColorIdx()}-color)`,
                }}
                onClick={(e) => deps.selection.handleWipClick(e)}
              >
                <span
                  class="commit-graph__wip-tint"
                  aria-hidden="true"
                  style={{ left: `${deps.layout.wipNodeX()}px` }}
                />
                <span
                  class="commit-graph__wip-node"
                  aria-hidden="true"
                  style={{ left: `${deps.layout.wipNodeX()}px` }}
                />
                {/* Layer 4 — conflict triangle (issue #53). Anchored at
                    the WIP node's upper-right slot. Overrides the WIP
                    cell's 0.7 opacity via `opacity: 1` on the wrapper.
                    Visible only when `RepoState.conflict_paths` is
                    non-empty. */}
                <Show when={hasConflicts()}>
                  <svg
                    class="commit-graph__wip-conflict"
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    style={{
                      position: "absolute",
                      left: `${deps.layout.wipNodeX() + 5}px`,
                      top: "5px",
                      opacity: 1,
                    }}
                    aria-label="Working tree has unresolved conflicts"
                  >
                    <title>Working tree has unresolved conflicts</title>
                    <path
                      d="M 0 2 L 12 2 L 6 12 z"
                      fill="#e74c3c"
                      stroke="#000"
                      stroke-width="0.5"
                    />
                    <text
                      x="6"
                      y="9.5"
                      font-size="7"
                      font-weight="700"
                      text-anchor="middle"
                      fill="#fff"
                    >
                      !
                    </text>
                  </svg>
                </Show>
              </li>
              </Tooltip>
              {/* WIP-to-HEAD dashed connector — 1:1 with GitKraken's
                  `stroke-dasharray="5 5"` SVG path. Travels from the WIP
                  node's centre (row 0 midpoint) down to HEAD's circle
                  centre, vertical-only since both share the HEAD lane.
                  Hidden when HEAD is not visible in the current stream. */}
              <Show when={deps.layout.headRowIndex() >= 0}>
                <svg
                  class="commit-graph__wip-edge"
                  style={{
                    width: `${deps.layout.graphContentWidth()}px`,
                    height: `${(deps.layout.headRowIndex() + 1) * ROW_HEIGHT + ROW_HEIGHT / 2}px`,
                  }}
                  aria-hidden="true"
                >
                  <path
                    d={`M ${deps.layout.wipNodeX()} ${ROW_HEIGHT / 2} L ${deps.layout.wipNodeX()} ${(deps.layout.headRowIndex() + 1) * ROW_HEIGHT + ROW_HEIGHT / 2}`}
                    stroke={`var(--column-${deps.layout.headColorIdx()}-color)`}
                    stroke-width="2"
                    stroke-dasharray="5 5"
                    fill="none"
                  />
                </svg>
              </Show>
            </Show>
            <For each={deps.virtualizer.getVirtualItems()}>
              {(item) => {
                const r = deps.rows()[item.index];
                if (!r) return null;
                // Reactive getters — recompute when commitZoneMode flips
                // so the tint anchor follows the new node geometry. A
                // plain const here would freeze on first mount and leave
                // the tint offset by the dim delta after a mode change.
                const tintLeft = () => {
                  const d = getRenderDims(commitZoneMode() === "compact");
                  return d.gutter + r.lane * d.laneWidth + d.laneWidth / 2;
                };
                const tintHeight = () =>
                  getRenderDims(commitZoneMode() === "compact").commitRadius *
                  2;
                return (
                  <li
                    class={rowWrapperClass(r.is_merge ? "merge" : "commit")}
                    classList={{
                      "is-hovering": deps.hoveredCommit() === r.sha,
                      "is-selected": deps.selection.selectedShasSet().has(r.sha),
                      "is-dimmed": !isRowVisible(r, hoveredRef(), commitFilter(), pathShaSet()),
                    }}
                    data-selected={
                      deps.selection.selectedShasSet().has(r.sha)
                        ? "true"
                        : "false"
                    }
                    style={{
                      top: `${item.start + deps.layout.wipShift()}px`,
                      height: `${ROW_HEIGHT}px`,
                      "--row-lane-color": `var(--lane-${r.color_idx % 10})`,
                    }}
                    onClick={(e) => deps.selection.handleCommitClick(e, r.sha)}
                    onMouseEnter={() => deps.setHoveredCommit(r.sha)}
                    onMouseLeave={() => {
                      if (deps.hoveredCommit() === r.sha)
                        deps.setHoveredCommit(undefined);
                    }}
                  >
                    <span
                      class="commit-graph__row-tint"
                      aria-hidden="true"
                      style={{
                        left: `${tintLeft()}px`,
                        height: `${tintHeight()}px`,
                      }}
                    />
                    <CommitRowGraph
                      row={r}
                      edges={deps.edgeStates()[item.index] ?? new Map()}
                      hostingService={deps.hostingService()}
                      compact={commitZoneMode() === "compact"}
                      isHovered={deps.hoveredCommit() === r.sha}
                    />
                  </li>
                );
              }}
            </For>
          </ul>
        </div>
        {/* Streaks overlay — absolute at the zone's right edge,
            OUTSIDE the horizontal scroll container so it stays pinned
            to the viewport during horizontal scroll. Each per-row
            streak mirrors the row's lane color (ports GK's
            `color-strip` from `GutterBackgroundStreak`). */}
        <div class="commit-graph__col-graph-streaks" aria-hidden="true">
          <div
            class="commit-graph__col-graph-streaks-inner"
            style={{ height: `${deps.layout.totalHeight()}px` }}
          >
            <For each={deps.virtualizer.getVirtualItems()}>
              {(item) => {
                const r = deps.rows()[item.index];
                if (!r) return null;
                const streakHeight = () =>
                  getRenderDims(commitZoneMode() === "compact").commitRadius *
                  2;
                return (
                  <span
                    class="commit-graph__lane-streak"
                    style={{
                      top: `${item.start + (ROW_HEIGHT - streakHeight()) / 2 + deps.layout.wipShift()}px`,
                      height: `${streakHeight()}px`,
                      "background-color": `var(--lane-${r.color_idx % 10})`,
                    }}
                  />
                );
              }}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}
