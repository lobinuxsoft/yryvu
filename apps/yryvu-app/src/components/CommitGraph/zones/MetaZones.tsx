// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import {
  activeColumnSettings,
  dirtyFileCount,
  hoveredRef,
} from "../../../state";
import { formatCommitDateTime } from "../columns";
import { isRowMemberOfHoveredRef } from "../hoverDim";
import { rowWrapperClass } from "../rowClass";
import { AuthorBadge, ROW_HEIGHT } from "../RowRenderer";
import { Tooltip } from "../../Tooltip";
import type { ZoneDeps } from "./types";

/**
 * Threshold below which the Author cell renders avatar-only (initials
 * badge with the lane color) instead of the author name. 1:1 with GK's
 * `COMMIT_AUTHOR_ZONE_SHOW_ICON_WIDTH = 55` constant from the bundle.
 * Resizing the Author column under 55 px swaps the rendering.
 */
const AUTHOR_ICON_WIDTH_THRESHOLD = 55;

/**
 * Meta zones — Author / Date-Time / SHA. Each is the same cell shape:
 * empty WIP placeholder + virtualized list of commit rows with one
 * inner span per zone. Bundled in one file because together they're
 * still well under the monolith threshold and the JSX is highly
 * uniform.
 */
export function MetaZones(props: { deps: ZoneDeps }) {
  const { deps } = props;
  return (
    <>
      <AuthorZone deps={deps} />
      <DateTimeZone deps={deps} />
      <ShaZone deps={deps} />
    </>
  );
}

function AuthorZone(props: { deps: ZoneDeps }) {
  const { deps } = props;
  return (
    <Show when={activeColumnSettings("commitAuthor").visible}>
      <div
        class="commit-graph__zone commit-graph__zone--author"
        style={{ order: activeColumnSettings("commitAuthor").order }}
      >
        <ul
          class="commit-graph__col-author"
          style={{ height: `${deps.layout.totalHeight()}px` }}
        >
          <Show when={dirtyFileCount() > 0}>
            <li
              class="commit-graph__wip-cell commit-graph__wip-cell--author"
              style={{ top: "0px", height: `${ROW_HEIGHT}px` }}
            />
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
                    "--row-lane-color": `var(--lane-${r.color_idx % 10})`,
                  }}
                  onClick={(e) => deps.selection.handleCommitClick(e, r.sha)}
                  onMouseEnter={() => deps.setHoveredCommit(r.sha)}
                  onMouseLeave={() => {
                    if (deps.hoveredCommit() === r.sha)
                      deps.setHoveredCommit(undefined);
                  }}
                >
                  <Show
                    when={
                      activeColumnSettings("commitAuthor").width >
                      AUTHOR_ICON_WIDTH_THRESHOLD
                    }
                    fallback={
                      <Tooltip text={r.author_name}>
                        <span class="commit-graph__author commit-graph__author--icon">
                          <AuthorBadge
                            authorEmail={r.author_email}
                            authorInitials={r.author_initials}
                            gravatarHash={r.gravatar_hash}
                            hostingService={deps.hostingService()}
                            colorIdx={r.color_idx}
                          />
                        </span>
                      </Tooltip>
                    }
                  >
                    <Tooltip text={r.author_name}>
                      <span class="commit-graph__author">
                        {r.author_name}
                      </span>
                    </Tooltip>
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

function DateTimeZone(props: { deps: ZoneDeps }) {
  const { deps } = props;
  return (
    <Show when={activeColumnSettings("commitDateTime").visible}>
      <div
        class="commit-graph__zone commit-graph__zone--date-time"
        style={{ order: activeColumnSettings("commitDateTime").order }}
      >
        <ul
          class="commit-graph__col-date-time"
          style={{ height: `${deps.layout.totalHeight()}px` }}
        >
          <Show when={dirtyFileCount() > 0}>
            <li
              class="commit-graph__wip-cell commit-graph__wip-cell--date-time"
              style={{ top: "0px", height: `${ROW_HEIGHT}px` }}
            />
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
                    "--row-lane-color": `var(--lane-${r.color_idx % 10})`,
                  }}
                  onClick={(e) => deps.selection.handleCommitClick(e, r.sha)}
                  onMouseEnter={() => deps.setHoveredCommit(r.sha)}
                  onMouseLeave={() => {
                    if (deps.hoveredCommit() === r.sha)
                      deps.setHoveredCommit(undefined);
                  }}
                >
                  <span class="commit-graph__date-time">
                    {formatCommitDateTime(r.author_date)}
                  </span>
                </li>
              );
            }}
          </For>
        </ul>
      </div>
    </Show>
  );
}

function ShaZone(props: { deps: ZoneDeps }) {
  const { deps } = props;
  return (
    <Show when={activeColumnSettings("commitSha").visible}>
      <div
        class="commit-graph__zone commit-graph__zone--sha"
        style={{ order: activeColumnSettings("commitSha").order }}
      >
        <ul
          class="commit-graph__col-sha"
          style={{ height: `${deps.layout.totalHeight()}px` }}
        >
          <Show when={dirtyFileCount() > 0}>
            <li
              class="commit-graph__wip-cell commit-graph__wip-cell--sha"
              style={{ top: "0px", height: `${ROW_HEIGHT}px` }}
            />
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
                    "--row-lane-color": `var(--lane-${r.color_idx % 10})`,
                  }}
                  onClick={(e) => deps.selection.handleCommitClick(e, r.sha)}
                  onMouseEnter={() => deps.setHoveredCommit(r.sha)}
                  onMouseLeave={() => {
                    if (deps.hoveredCommit() === r.sha)
                      deps.setHoveredCommit(undefined);
                  }}
                >
                  <span class="commit-graph__sha">{r.short_sha}</span>
                </li>
              );
            }}
          </For>
        </ul>
      </div>
    </Show>
  );
}
