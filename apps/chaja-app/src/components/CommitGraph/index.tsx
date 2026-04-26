// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";

import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  getHostingService,
  streamGraph,
  type GraphRow,
  type HostingService,
} from "../../ipc";
import {
  activeColumnSettings,
  amendEnabled,
  commitZoneMode,
  commitMessage,
  dirtyFileCount,
  graphNonce,
  hoveredRef,
  inspectorMode,
  selectedCommit,
  setCommitMessage,
  setInspectorMode,
  setPinnedSha,
  setSelectedCommit,
  setStaleRefs,
  smartBranchesEnabled,
  SMART_BRANCH_STALE_DAYS,
} from "../../state";
import { isRowMemberOfHoveredRef } from "./hoverDim";
import { ContextMenu } from "../ContextMenu";
import { CommitDialogs } from "./CommitDialogs";
import { createCommitOps } from "./useCommitOps";
import { RefPillGroup } from "./RefPills";
import {
  AuthorBadge,
  CommitRowGraph,
  getRenderDims,
  ROW_HEIGHT,
} from "./RowRenderer";
import { createIncrementalEdgeStates } from "./edgeStates";
import { formatCommitDateTime } from "./columns";
import { createVirtualizer } from "@tanstack/solid-virtual";

/**
 * Threshold below which the Author cell renders avatar-only (initials
 * badge with the lane color) instead of the author name. 1:1 with GK's
 * `COMMIT_AUTHOR_ZONE_SHOW_ICON_WIDTH = 55` constant from the bundle.
 * Resizing the Author column under 55 px swaps the rendering.
 */
const AUTHOR_ICON_WIDTH_THRESHOLD = 55;

/**
 * Module-level className cache (Bd pattern from doc 12 — row wrapper).
 * Keyed by `type + isHovering + isSelected` concatenation. Solid's reactivity
 * is granular enough to avoid needing this strictly, but adopting matches
 * GitKraken's render hot-path optimization for 1:1 parity.
 */
const rowWrapperClassCache = new Map<string, string>();
function rowWrapperClass(
  type: "commit" | "merge" | "wip",
  isHovering: boolean,
  isSelected: boolean,
): string {
  const key = `${type}|${isHovering ? 1 : 0}|${isSelected ? 1 : 0}`;
  let cls = rowWrapperClassCache.get(key);
  if (cls) return cls;
  const parts = ["graph-row-wrapper", `graph-row-wrapper--${type}`];
  if (isHovering) parts.push("is-hovering");
  if (isSelected) parts.push("is-selected");
  cls = parts.join(" ");
  rowWrapperClassCache.set(key, cls);
  return cls;
}

export interface CommitGraphProps {
  repoPath: string;
}

export function CommitGraph(props: CommitGraphProps) {
  const [rows, setRows] = createSignal<GraphRow[]>([]);
  const [hoveredCommit, setHoveredCommit] = createSignal<string | undefined>(
    undefined,
  );
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | undefined>(undefined);
  /**
   * Provider tag for the repo's primary remote. Re-queried whenever the
   * repo path changes. Drives avatar URL resolution per row — `"github"`
   * routes through the GitHub CDN's email endpoint (no API auth needed),
   * anything else falls back to Gravatar.
   */
  const [hostingService, setHostingService] =
    createSignal<HostingService>("unknown");

  const ops = createCommitOps({
    copyText: (text) => navigator.clipboard.writeText(text),
    pickSaveDir: async () => {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose output directory for the patch",
      });
      if (!selected) return null;
      return Array.isArray(selected) ? selected[0] ?? null : selected;
    },
  });

  // (Re-)stream the commit graph whenever the repo path or graphNonce changes.
  createEffect(() => {
    const path = props.repoPath;
    graphNonce();
    setRows([]);
    setLoading(true);
    setError(undefined);
    const handle = streamGraph(
      path,
      (batch) => {
        setRows((prev) => prev.concat(batch));
      },
      {
        onPinned: (sha) => setPinnedSha(sha ?? undefined),
      },
    );
    handle.promise
      .then(() => setLoading(false))
      .catch((e) => {
        setLoading(false);
        setError(String(e));
      });
    onCleanup(() => handle.stop());
  });

  // Detect the hosting-service tag once per repo path change. One-shot
  // query — the remote doesn't change while the graph is being rendered.
  createEffect(() => {
    const path = props.repoPath;
    setHostingService("unknown");
    getHostingService(path)
      .then(setHostingService)
      .catch(() => setHostingService("unknown"));
  });

  // When the working tree is dirty, GK reserves the top slot of the
  // commit list (index 0) for the WIP pseudo-node — see research doc 07
  // and `getCommitOrderWithWipNode = compact(concat(wip, order))` in the
  // GK bundle. That means the WIP scrolls with the list; it is NOT
  // sticky. We model this by shifting every real commit's `top` down by
  // `wipShift()` pixels and rendering the WIP row absolute-positioned
  // inside the same scroll-synced coordinate system.
  const wipShift = () => (dirtyFileCount() > 0 ? ROW_HEIGHT : 0);
  const totalHeight = () => virtualizer.getTotalSize() + wipShift();

  /* ========================================================================
     Graph-column intrinsic width (#141 follow-up) — when the repo fans out
     beyond the GRAPH cell's viewport width, lanes disappear off the right
     edge. GitKraken solves this by letting the commitZone be the only
     zone without a `maximumWidth`: the column renders at its natural
     `numGraphColumns * columnWidth` and the container scrolls horizontally
     when it exceeds the cell. We get the same effect by sizing an inner
     wrapper to the natural content width and putting `overflow-x: auto`
     on the cell.

     `maxLane` walks rows + parent_lanes only (O(n·k)). Pass-through edges
     never visit a lane that didn't start as a `row.lane` or `parent_lane`
     somewhere in the walk, so this upper-bounds the active-lane set
     correctly without touching edgeStates. */
  const maxLane = createMemo(() => {
    let max = 0;
    const all = rows();
    for (const r of all) {
      if (r.lane > max) max = r.lane;
      for (const pl of r.parent_lanes) if (pl > max) max = pl;
    }
    return max;
  });
  const graphContentWidth = createMemo(() => {
    const dims = getRenderDims(commitZoneMode() === "compact");
    return dims.gutter + (maxLane() + 1) * dims.laneWidth + 8;
  });

  // Push the user-controlled column widths to CSS custom properties on
  // `.main` so both the header strip and the zones below pick them up
  // through the same inheritance chain. Driven by the persisted
  // `graphColumnWidths` signal — column-resize handles write to it,
  // settings-menu presets reset it, and we just react.
  let rootEl: HTMLDivElement | undefined;
  onMount(() => {
    const main = rootEl?.closest(".main") as HTMLElement | null;
    if (!main) return;
    createEffect(() => {
      // Active settings come from the current mode's slice — toggling
      // Compact / Default rebinds widths in one shot.
      main.style.setProperty(
        "--graph-col-branch",
        `${activeColumnSettings("ref").width}px`,
      );
      main.style.setProperty(
        "--graph-col-graph",
        `${activeColumnSettings("graph").width}px`,
      );
      main.style.setProperty(
        "--graph-col-message",
        `${activeColumnSettings("commitMessage").width}px`,
      );
      main.style.setProperty(
        "--graph-col-author",
        `${activeColumnSettings("commitAuthor").width}px`,
      );
      main.style.setProperty(
        "--graph-col-date-time",
        `${activeColumnSettings("commitDateTime").width}px`,
      );
      main.style.setProperty(
        "--graph-col-sha",
        `${activeColumnSettings("commitSha").width}px`,
      );
    });
    // Smart Branch Visibility pass — populate the `staleRefs` set with
    // any ref whose tip commit is older than the staleness threshold.
    // Iterates `rows()` once per change; cheap because we already track
    // tip-row alignment via the graph stream.
    createEffect(() => {
      if (!smartBranchesEnabled()) {
        setStaleRefs(new Set());
        return;
      }
      const thresholdSec = SMART_BRANCH_STALE_DAYS * 24 * 3600;
      const nowSec = Date.now() / 1000;
      const stale = new Set<string>();
      for (const row of rows()) {
        if (nowSec - row.author_date <= thresholdSec) continue;
        for (const ref of row.refs) {
          // HEAD is never auto-hidden — would erase the active checkout
          // marker even after a long break.
          if (ref.kind === "Head") continue;
          stale.add(`${ref.kind}/${ref.name}`);
        }
      }
      setStaleRefs(stale);
    });
    onCleanup(() => {
      main.style.removeProperty("--graph-col-branch");
      main.style.removeProperty("--graph-col-graph");
      main.style.removeProperty("--graph-col-message");
      main.style.removeProperty("--graph-col-author");
      main.style.removeProperty("--graph-col-date-time");
      main.style.removeProperty("--graph-col-sha");
    });
  });
  // HEAD row drives the WIP pseudo-row: its lane pins the dashed node
  // horizontally, its color tints the connector + borders, and its
  // `kind: "Head"` ref surfaces the current branch name for the
  // placeholder label. Assumes `rows()[0]` is HEAD (topmost ordering),
  // which the current commit-walker guarantees.
  const headRow = createMemo(() => rows()[0]);
  const headLane = createMemo(() => headRow()?.lane ?? 0);
  const headColorIdx = createMemo(() => (headRow()?.color_idx ?? 0) % 10);
  const headBranchName = createMemo(
    () => headRow()?.refs.find((r) => r.kind === "Head")?.name,
  );
  const wipNodeX = () => {
    const dims = getRenderDims(commitZoneMode() === "compact");
    return dims.gutter + headLane() * dims.laneWidth + dims.laneWidth / 2;
  };

  /* ========================================================================
     Row virtualization (#141) — only mount rows visible in the viewport plus
     a small overscan.

     Scroll architecture: the MESSAGE zone is the single source of truth
     for vertical scroll. BRANCH/TAG and GRAPH zones have
     `overflow-y: hidden` and their inner UL is repositioned with
     `transform: translateY(-scrollTop)`. Wheel events on the silent
     zones forward their `deltaY` to messagesScroll.

     Why not sync 3 scrollTops: setting `scrollTop` on sibling elements
     on every wheel tick triggers layout thrashing and visible lag.
     Translating two ULs via GPU-accelerated transform is faster and —
     critically — makes the "phantom" vertical scrollbar in the GRAPH
     zone impossible (it has no scroll of its own, so there's nothing
     to render).
     ======================================================================== */
  const OVERSCAN_ROWS = 8;
  let zonesScroll: HTMLDivElement | undefined;

  // Vertical virtualizer 1:1 with GK's `MultiGrid` (which underlies its
  // graph view in `react-virtualized`). Single instance shared across
  // every visible zone — they all iterate the same `getVirtualItems()`,
  // so a commit's row across BRANCH/TAG / GRAPH / MESSAGE / AUTHOR /
  // DATE-TIME / SHA stays at the same `start` offset. The scroll
  // element is the `.commit-graph__zones` container so toggling any
  // single zone off doesn't lose the scroll provider.
  const virtualizer = createVirtualizer({
    get count() {
      return rows().length;
    },
    getScrollElement: () => zonesScroll ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  });

  /**
   * Per-row edges dict — literal port of GitKraken's
   * `getFinalEdgeStateForGraphAndRow` pipeline. Each row gets a
   * `Map<column, {starting?, passThrough?, ending?}>` that the renderer
   * iterates to dispatch one of three drawing primitives per column.
   *
   * Incremental (#141): the builder closure caches the running result
   * array + last `prev` Map. Each `rows()` change only processes the
   * delta beyond the previous length — turns the per-batch O(N) full
   * recompute into O(batch_size), preventing O(N²) total on large
   * streams that bricked the event loop.
   *
   * Backed by a `{ equals: false }` signal because the incremental
   * builder mutates a stable result array in place, so reference
   * equality alone wouldn't fire downstream updates. The effect runs
   * on every `rows()` change and pushes the new (same-ref) array.
   */
  const incrementalBuilder = createIncrementalEdgeStates();
  const [edgeStates, setEdgeStates] = createSignal(incrementalBuilder([]), {
    equals: false,
  });
  createEffect(() => {
    setEdgeStates(incrementalBuilder(rows()));
  });

  function openStaging() {
    // Guard: no point entering the commit panel with a clean tree unless
    // the user is composing an amend (reword of HEAD). Clicking the WIP
    // row on a clean repo used to drop users into an empty panel with
    // all-zero counts, which read as "there are uncommitted changes"
    // just because the UI was visible.
    if (dirtyFileCount() === 0 && !amendEnabled()) return;
    setSelectedCommit(undefined);
    setInspectorMode("staging");
  }

  return (
    <div class="commit-graph" ref={rootEl}>
      <Show when={error()}>
        <div class="commit-graph__error">Error: {error()}</div>
      </Show>
      <Show when={loading()}>
        <div class="commit-graph__status">Loading…</div>
      </Show>
      {/* WIP pseudo-row — ports GitKraken's architecture exactly: the
          WIP is NOT a sibling floating above the zones; it is a regular
          cell at row 0 inside each zone's Grid. GK's `cellRenderer`
          branches on `type === workDirType` (`ba.bY` in the bundle) and
          renders per-zone content. We mirror that by injecting a `<li>`
          at the top of each zone's `<ul>` when `dirtyFileCount > 0`.
          That way each cell inherits its zone's scroll coordinate
          system — the GRAPH cell lives inside the horizontal scroll
          wrapper, so the node follows horizontal pan too. */}
      <div
        class="commit-graph__zones"
        ref={zonesScroll}
        
      >
        <Show when={activeColumnSettings("ref").visible}>
        <div
          class="commit-graph__zone commit-graph__zone--branch"
          style={{ order: activeColumnSettings("ref").order }}
          
        >
          <ul
            class="commit-graph__col-branch"
            style={{
              height: `${totalHeight()}px`,

            }}
          >
            <Show when={dirtyFileCount() > 0}>
              <li
                class="commit-graph__wip-cell commit-graph__wip-cell--branch"
                data-active={inspectorMode() === "staging" ? "true" : "false"}
                style={{ top: "0px", height: `${ROW_HEIGHT}px` }}
                onClick={() => openStaging()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openStaging();
                  }
                }}
                title="View working-directory changes"
              />
            </Show>
            <For each={virtualizer.getVirtualItems()}>
              {(item) => {
                const r = rows()[item.index];
                if (!r) return null;
                
                return (
                  <li
                    class={rowWrapperClass(
                      r.is_merge ? "merge" : "commit",
                      hoveredCommit() === r.sha,
                      selectedCommit() === r.sha,
                    )}
                    classList={{
                      "is-dimmed": !isRowMemberOfHoveredRef(r, hoveredRef()),
                    }}
                    data-selected={selectedCommit() === r.sha ? "true" : "false"}
                    style={{
                      top: `${item.start + wipShift()}px`,
                      height: `${ROW_HEIGHT}px`,
                      "--row-lane-color": `var(--column-${r.color_idx % 10}-color)`,
                    }}
                    onMouseEnter={() => setHoveredCommit(r.sha)}
                    onMouseLeave={() => {
                      if (hoveredCommit() === r.sha) setHoveredCommit(undefined);
                    }}
                  >
                    <RefPillGroup
                      refs={r.refs}
                      sha={r.sha}
                      childRefs={r.child_refs}
                      isRowHovered={hoveredCommit() === r.sha}
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
                          "background-color": `var(--column-${r.color_idx % 10}-color)`,
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
        <Show when={activeColumnSettings("graph").visible}>
        <div
          class="commit-graph__zone commit-graph__zone--graph"
          classList={{ "is-compact": commitZoneMode() === "compact" }}
          style={{ order: activeColumnSettings("graph").order }}
          
        >
          {/* Horizontal scroll container — nested inside the zone so the
              right-edge streaks overlay (below) can be absolute-positioned
              against the ZONE's viewport, not against the scrollable
              content. Ports GitKraken's `RightGutter` pattern (doc 11 /
              `left: scrollLeft + commitZoneWidth - width`). */}
          <div class="commit-graph__col-graph-hscroll">
            <ul
              class="commit-graph__col-graph"
              style={{
                height: `${totalHeight()}px`,
                "min-width": `${graphContentWidth()}px`,
              }}
            >
              <Show when={dirtyFileCount() > 0}>
                <li
                  class="commit-graph__wip-cell commit-graph__wip-cell--graph"
                  data-active={inspectorMode() === "staging" ? "true" : "false"}
                  style={{
                    top: "0px",
                    height: `${ROW_HEIGHT}px`,
                    "--wip-lane-color": `var(--column-${headColorIdx()}-color)`,
                  }}
                  onClick={() => openStaging()}
                  title="View working-directory changes"
                >
                  <span
                    class="commit-graph__wip-tint"
                    aria-hidden="true"
                    style={{ left: `${wipNodeX()}px` }}
                  />
                  <span
                    class="commit-graph__wip-node"
                    aria-hidden="true"
                    style={{ left: `${wipNodeX()}px` }}
                  />
                </li>
              </Show>
              <For each={virtualizer.getVirtualItems()}>
                {(item) => {
                const r = rows()[item.index];
                if (!r) return null;
                const dims = getRenderDims(commitZoneMode() === "compact");
                const nodeX = dims.gutter + r.lane * dims.laneWidth + dims.laneWidth / 2;
                  return (
                    <li
                      class={rowWrapperClass(
                        r.is_merge ? "merge" : "commit",
                        hoveredCommit() === r.sha,
                        selectedCommit() === r.sha,
                      )}
                      classList={{
                        "is-dimmed": !isRowMemberOfHoveredRef(r, hoveredRef()),
                      }}
                      data-selected={selectedCommit() === r.sha ? "true" : "false"}
                      style={{
                        top: `${item.start + wipShift()}px`,
                        height: `${ROW_HEIGHT}px`,
                        "--row-lane-color": `var(--column-${r.color_idx % 10}-color)`,
                      }}
                      onClick={() => setSelectedCommit(r.sha)}
                      onMouseEnter={() => setHoveredCommit(r.sha)}
                      onMouseLeave={() => {
                        if (hoveredCommit() === r.sha) setHoveredCommit(undefined);
                      }}
                    >
                      <span
                        class="commit-graph__row-tint"
                        aria-hidden="true"
                        style={{ left: `${nodeX}px` }}
                      />
                      <CommitRowGraph
                        row={r}
                        edges={edgeStates()[item.index] ?? new Map()}
                        hostingService={hostingService()}
                        compact={commitZoneMode() === "compact"}
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
              style={{
                height: `${totalHeight()}px`,
  
              }}
            >
              <For each={virtualizer.getVirtualItems()}>
                {(item) => {
                const r = rows()[item.index];
                if (!r) return null;
                  
                  return (
                    <span
                      class="commit-graph__lane-streak"
                      style={{
                        top: `${item.start + (ROW_HEIGHT - 22) / 2 + wipShift()}px`,
                        "background-color": `var(--column-${r.color_idx % 10}-color)`,
                      }}
                    />
                  );
                }}
              </For>
            </div>
          </div>
        </div>
        </Show>
        <Show when={activeColumnSettings("commitMessage").visible}>
        <div
          class="commit-graph__zone commit-graph__zone--messages"
          style={{ order: activeColumnSettings("commitMessage").order }}
        >
          <ul
            class="commit-graph__col-messages"
            style={{ height: `${totalHeight()}px` }}
          >
            <Show when={dirtyFileCount() > 0}>
              <li
                class="commit-graph__wip-cell commit-graph__wip-cell--messages"
                data-active={inspectorMode() === "staging" ? "true" : "false"}
                style={{ top: "0px", height: `${ROW_HEIGHT}px` }}
                onClick={() => openStaging()}
                title="View working-directory changes"
              >
                <input
                  class="commit-graph__wip-input"
                  type="text"
                  placeholder={
                    headBranchName()
                      ? `WIP on ${headBranchName()}`
                      : "WIP"
                  }
                  value={commitMessage()}
                  onInput={(e) => setCommitMessage(e.currentTarget.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span class="commit-graph__wip-badge">+{dirtyFileCount()}</span>
              </li>
            </Show>
            <For each={virtualizer.getVirtualItems()}>
              {(item) => {
                const r = rows()[item.index];
                if (!r) return null;
                
                return (
                  <li
                    class={rowWrapperClass(
                      r.is_merge ? "merge" : "commit",
                      hoveredCommit() === r.sha,
                      selectedCommit() === r.sha,
                    )}
                    classList={{
                      "is-dimmed": !isRowMemberOfHoveredRef(r, hoveredRef()),
                    }}
                    data-selected={selectedCommit() === r.sha ? "true" : "false"}
                    style={{
                      top: `${item.start + wipShift()}px`,
                      height: `${ROW_HEIGHT}px`,
                      "--row-lane-color": `var(--column-${r.color_idx % 10}-color)`,
                    }}
                    onClick={() => setSelectedCommit(r.sha)}
                    onMouseEnter={() => setHoveredCommit(r.sha)}
                    onMouseLeave={() => {
                      if (hoveredCommit() === r.sha) setHoveredCommit(undefined);
                    }}
                    onContextMenu={(e) =>
                      ops.openCommitContextMenu(e, r.sha, r.short_sha)
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
        <Show when={activeColumnSettings("commitAuthor").visible}>
          <div
            class="commit-graph__zone commit-graph__zone--author"
            style={{ order: activeColumnSettings("commitAuthor").order }}
            
          >
            <ul
              class="commit-graph__col-author"
              style={{
                height: `${totalHeight()}px`,
  
              }}
            >
              <Show when={dirtyFileCount() > 0}>
                <li
                  class="commit-graph__wip-cell commit-graph__wip-cell--author"
                  style={{ top: "0px", height: `${ROW_HEIGHT}px` }}
                />
              </Show>
              <For each={virtualizer.getVirtualItems()}>
                {(item) => {
                const r = rows()[item.index];
                if (!r) return null;
                  
                  return (
                    <li
                      class={rowWrapperClass(
                        r.is_merge ? "merge" : "commit",
                        hoveredCommit() === r.sha,
                        selectedCommit() === r.sha,
                      )}
                      classList={{
                        "is-dimmed": !isRowMemberOfHoveredRef(r, hoveredRef()),
                      }}
                      data-selected={selectedCommit() === r.sha ? "true" : "false"}
                      style={{
                        top: `${item.start + wipShift()}px`,
                        height: `${ROW_HEIGHT}px`,
                        "--row-lane-color": `var(--column-${r.color_idx % 10}-color)`,
                      }}
                      onClick={() => setSelectedCommit(r.sha)}
                      onMouseEnter={() => setHoveredCommit(r.sha)}
                      onMouseLeave={() => {
                        if (hoveredCommit() === r.sha) setHoveredCommit(undefined);
                      }}
                    >
                      <Show
                        when={
                          activeColumnSettings("commitAuthor").width >
                          AUTHOR_ICON_WIDTH_THRESHOLD
                        }
                        fallback={
                          <span
                            class="commit-graph__author commit-graph__author--icon"
                            title={r.author_name}
                          >
                            <AuthorBadge
                              authorEmail={r.author_email}
                              authorInitials={r.author_initials}
                              gravatarHash={r.gravatar_hash}
                              hostingService={hostingService()}
                              colorIdx={r.color_idx}
                            />
                          </span>
                        }
                      >
                        <span class="commit-graph__author" title={r.author_name}>
                          {r.author_name}
                        </span>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ul>
          </div>
        </Show>
        <Show when={activeColumnSettings("commitDateTime").visible}>
          <div
            class="commit-graph__zone commit-graph__zone--date-time"
            style={{ order: activeColumnSettings("commitDateTime").order }}
            
          >
            <ul
              class="commit-graph__col-date-time"
              style={{
                height: `${totalHeight()}px`,
  
              }}
            >
              <Show when={dirtyFileCount() > 0}>
                <li
                  class="commit-graph__wip-cell commit-graph__wip-cell--date-time"
                  style={{ top: "0px", height: `${ROW_HEIGHT}px` }}
                />
              </Show>
              <For each={virtualizer.getVirtualItems()}>
                {(item) => {
                const r = rows()[item.index];
                if (!r) return null;
                  
                  return (
                    <li
                      class={rowWrapperClass(
                        r.is_merge ? "merge" : "commit",
                        hoveredCommit() === r.sha,
                        selectedCommit() === r.sha,
                      )}
                      classList={{
                        "is-dimmed": !isRowMemberOfHoveredRef(r, hoveredRef()),
                      }}
                      data-selected={selectedCommit() === r.sha ? "true" : "false"}
                      style={{
                        top: `${item.start + wipShift()}px`,
                        height: `${ROW_HEIGHT}px`,
                        "--row-lane-color": `var(--column-${r.color_idx % 10}-color)`,
                      }}
                      onClick={() => setSelectedCommit(r.sha)}
                      onMouseEnter={() => setHoveredCommit(r.sha)}
                      onMouseLeave={() => {
                        if (hoveredCommit() === r.sha) setHoveredCommit(undefined);
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
        <Show when={activeColumnSettings("commitSha").visible}>
          <div
            class="commit-graph__zone commit-graph__zone--sha"
            style={{ order: activeColumnSettings("commitSha").order }}
            
          >
            <ul
              class="commit-graph__col-sha"
              style={{
                height: `${totalHeight()}px`,
  
              }}
            >
              <Show when={dirtyFileCount() > 0}>
                <li
                  class="commit-graph__wip-cell commit-graph__wip-cell--sha"
                  style={{ top: "0px", height: `${ROW_HEIGHT}px` }}
                />
              </Show>
              <For each={virtualizer.getVirtualItems()}>
                {(item) => {
                const r = rows()[item.index];
                if (!r) return null;
                  
                  return (
                    <li
                      class={rowWrapperClass(
                        r.is_merge ? "merge" : "commit",
                        hoveredCommit() === r.sha,
                        selectedCommit() === r.sha,
                      )}
                      classList={{
                        "is-dimmed": !isRowMemberOfHoveredRef(r, hoveredRef()),
                      }}
                      data-selected={selectedCommit() === r.sha ? "true" : "false"}
                      style={{
                        top: `${item.start + wipShift()}px`,
                        height: `${ROW_HEIGHT}px`,
                        "--row-lane-color": `var(--column-${r.color_idx % 10}-color)`,
                      }}
                      onClick={() => setSelectedCommit(r.sha)}
                      onMouseEnter={() => setHoveredCommit(r.sha)}
                      onMouseLeave={() => {
                        if (hoveredCommit() === r.sha) setHoveredCommit(undefined);
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
      </div>
      <Show when={ops.menu()}>
        <ContextMenu
          x={ops.menu()!.x}
          y={ops.menu()!.y}
          items={ops.menu()!.items}
          onClose={() => ops.setMenu(null)}
        />
      </Show>
      <CommitDialogs ops={ops} />
    </div>
  );
}
