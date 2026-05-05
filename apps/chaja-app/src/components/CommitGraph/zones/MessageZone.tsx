// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import {
  activeColumnSettings,
  commitMessage,
  dirtyFileCount,
  hoveredRef,
  inspectorMode,
  setCommitMessage,
  workdirSelected,
} from "../../../state";
import { isRowMemberOfHoveredRef } from "../hoverDim";
import { rowWrapperClass } from "../rowClass";
import { ROW_HEIGHT } from "../RowRenderer";
import type { ZoneDeps } from "./types";

/**
 * Message zone — commit summaries plus the WIP message input. The WIP
 * input is the only inline editor in any zone; clicking it doesn't
 * propagate to the row's WIP-cell click handler so the user can place
 * the cursor without escalating into the staging composer.
 */
export function MessageZone(props: { deps: ZoneDeps }) {
  const { deps } = props;
  return (
    <Show when={activeColumnSettings("commitMessage").visible}>
      <div
        class="commit-graph__zone commit-graph__zone--messages"
        style={{ order: activeColumnSettings("commitMessage").order }}
      >
        <ul
          class="commit-graph__col-messages"
          style={{ height: `${deps.layout.totalHeight()}px` }}
        >
          <Show when={dirtyFileCount() > 0}>
            <li
              class="commit-graph__wip-cell commit-graph__wip-cell--messages"
              data-active={
                workdirSelected() || inspectorMode() === "staging"
                  ? "true"
                  : "false"
              }
              style={{ top: "0px", height: `${ROW_HEIGHT}px` }}
              onClick={(e) => deps.selection.handleWipClick(e)}
              title="View working-directory changes"
            >
              <input
                class="commit-graph__wip-input"
                type="text"
                placeholder={
                  deps.layout.headBranchName()
                    ? `WIP on ${deps.layout.headBranchName()}`
                    : "WIP"
                }
                value={commitMessage()}
                onInput={(e) => setCommitMessage(e.currentTarget.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <span class="commit-graph__wip-badge">+{dirtyFileCount()}</span>
            </li>
          </Show>
          <For each={deps.virtualizer.getVirtualItems()}>
            {(item) => {
              const r = deps.rows()[item.index];
              if (!r) return null;
              return (
                <li
                  class={rowWrapperClass(
                    r.is_merge ? "merge" : "commit",
                    deps.hoveredCommit() === r.sha,
                    deps.selection.selectedShasSet().has(r.sha),
                  )}
                  classList={{
                    "is-dimmed": !isRowMemberOfHoveredRef(r, hoveredRef()),
                  }}
                  data-selected={
                    deps.selection.selectedShasSet().has(r.sha)
                      ? "true"
                      : "false"
                  }
                  style={{
                    top: `${item.start + deps.layout.wipShift()}px`,
                    height: `${ROW_HEIGHT}px`,
                    "--row-lane-color": `var(--column-${r.color_idx % 10}-color)`,
                  }}
                  onClick={(e) => deps.selection.handleCommitClick(e, r.sha)}
                  onMouseEnter={() => deps.setHoveredCommit(r.sha)}
                  onMouseLeave={() => {
                    if (deps.hoveredCommit() === r.sha)
                      deps.setHoveredCommit(undefined);
                  }}
                  onContextMenu={(e) =>
                    deps.openCommitContextMenu?.(e, r.sha, r.short_sha)
                  }
                >
                  <span class="commit-graph__summary">{r.summary}</span>
                </li>
              );
            }}
          </For>
        </ul>
      </div>
    </Show>
  );
}
