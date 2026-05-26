// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import { commitFilter, hoveredRef, pathShaSet } from "../../../state";
import { activeColumnSettings, dirtyFileCount, inspectorMode, workdirSelected } from "../../../state";
import { isRowVisible } from "../hoverDim";
import { rowWrapperClass } from "../rowClass";
import { RefPillGroup } from "../RefPills";
import { ROW_HEIGHT } from "../RowRenderer";
import { Tooltip } from "../../Tooltip";
import type { ZoneDeps } from "./types";

/**
 * BRANCH/TAG column — leftmost zone. Renders a per-commit pill group
 * (HEAD + branches + tags) plus a lane-tinted connector that bridges
 * the gap between the last pill and the cell's right edge.
 */
export function BranchZone(props: { deps: ZoneDeps }) {
  const { deps } = props;
  return (
    <Show when={activeColumnSettings("ref").visible}>
      <div
        class="commit-graph__zone commit-graph__zone--branch"
        style={{ order: activeColumnSettings("ref").order }}
      >
        <ul
          class="commit-graph__col-branch"
          style={{ height: `${deps.layout.totalHeight()}px` }}
        >
          <Show when={dirtyFileCount() > 0}>
            <Tooltip text="View working-directory changes">
              <li
                class="commit-graph__wip-cell commit-graph__wip-cell--branch"
                data-active={
                  workdirSelected() || inspectorMode() === "staging"
                    ? "true"
                    : "false"
                }
                style={{ top: "0px", height: `${ROW_HEIGHT}px` }}
                onClick={(e) => deps.selection.handleWipClick(e)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    deps.selection.openStaging();
                  }
                }}
              />
            </Tooltip>
          </Show>
          <For each={deps.virtualizer.getVirtualItems()}>
            {(item) => {
              const r = deps.rows()[item.index];
              if (!r) return null;
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
                  onMouseEnter={() => deps.setHoveredCommit(r.sha)}
                  onMouseLeave={() => {
                    if (deps.hoveredCommit() === r.sha)
                      deps.setHoveredCommit(undefined);
                  }}
                >
                  <RefPillGroup
                    refs={r.refs}
                    sha={r.sha}
                    childRefs={r.child_refs}
                    isRowHovered={deps.hoveredCommit() === r.sha}
                  />
                  {/* Connector line (#127) — fills the gap between the
                      last pill and the right edge of the BRANCH/TAG
                      cell, tinted with the row's lane color. HEAD rows
                      get a 2-px variant as a "you are here" cue. */}
                  <Show when={r.refs.length > 0}>
                    <span
                      class="ref-connector"
                      classList={{
                        "ref-connector--head": r.refs.some(
                          (ref) => ref.kind === "Head",
                        ),
                      }}
                      aria-hidden="true"
                      style={{
                        "background-color": `var(--lane-${r.color_idx % 10})`,
                      }}
                    />
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </div>
    </Show>
  );
}
