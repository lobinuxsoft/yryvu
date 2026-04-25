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
  amendEnabled,
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
} from "../../state";
import { isRowMemberOfHoveredRef } from "./hoverDim";
import { ContextMenu } from "../ContextMenu";
import { CommitDialogs } from "./CommitDialogs";
import { createCommitOps } from "./useCommitOps";
import { RefPillGroup } from "./RefPills";
import {
  CommitRowGraph,
  GUTTER,
  LANE_WIDTH,
  ROW_HEIGHT,
} from "./RowRenderer";
import { createIncrementalEdgeStates } from "./edgeStates";

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
  const totalHeight = () => rows().length * ROW_HEIGHT + wipShift();

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
  const graphContentWidth = createMemo(
    () => GUTTER + (maxLane() + 1) * LANE_WIDTH + 8,
  );

  // Size the GRAPH zone to its content, capped at GRAPH_ZONE_MAX_PX.
  // GitKraken's bundle exposes `REF_ZONE_DEFAULT_WIDTH=130` /
  // `COMMIT_ZONE_DEFAULT_WIDTH=150` etc., but no fixed cap on the graph
  // zone — the user resizes it. Until column-resize lands (#37), 280 px
  // (≈12 lanes at 22 px each + gutter) covers the comfortable case
  // without donating half the viewport to dead lane space on busy
  // repos like `eggscape`. Wider repos pick up the horizontal scroll
  // already wired into `.col-graph-hscroll`.
  //
  // Written as a CSS custom property on `.main` so both the header row
  // and the zone pick it up via the same inheritance chain.
  const GRAPH_ZONE_MIN_PX = 80;
  const GRAPH_ZONE_MAX_PX = 280;
  let rootEl: HTMLDivElement | undefined;
  onMount(() => {
    const main = rootEl?.closest(".main") as HTMLElement | null;
    if (!main) return;
    createEffect(() => {
      const clamped = Math.max(
        GRAPH_ZONE_MIN_PX,
        Math.min(graphContentWidth() + 4, GRAPH_ZONE_MAX_PX),
      );
      main.style.setProperty("--graph-col-graph", `${clamped}px`);
    });
    onCleanup(() => {
      main.style.removeProperty("--graph-col-graph");
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
  const wipNodeX = () => GUTTER + headLane() * LANE_WIDTH + LANE_WIDTH / 2;

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
  let messagesScroll: HTMLDivElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);

  function forwardWheel(e: WheelEvent) {
    if (!messagesScroll || e.deltaY === 0) return;
    messagesScroll.scrollTop += e.deltaY;
  }

  onMount(() => {
    if (!messagesScroll) return;
    setViewportHeight(messagesScroll.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    ro.observe(messagesScroll);
    onCleanup(() => ro.disconnect());
  });

  const visibleRange = createMemo(() => {
    const total = rows().length;
    const vh = viewportHeight();
    if (total === 0 || vh === 0) return { start: 0, end: 0 };
    const st = scrollTop();
    const start = Math.max(0, Math.floor(st / ROW_HEIGHT) - OVERSCAN_ROWS);
    const end = Math.min(
      total,
      Math.ceil((st + vh) / ROW_HEIGHT) + OVERSCAN_ROWS,
    );
    return { start, end };
  });

  // Sliced row view. Returns references into `rows()` so <For>'s keyed
  // reconciliation matches items by identity — rows that stay in the
  // window during scroll don't remount, only their `top` offset updates.
  const visibleRows = createMemo(() => {
    const { start, end } = visibleRange();
    return rows().slice(start, end);
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
      <div class="commit-graph__zones">
        <div
          class="commit-graph__zone commit-graph__zone--branch"
          onWheel={forwardWheel}
        >
          <ul
            class="commit-graph__col-branch"
            style={{
              height: `${totalHeight()}px`,
              transform: `translateY(-${scrollTop()}px)`,
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
            <For each={visibleRows()}>
              {(r, i) => {
                const globalIndex = () => visibleRange().start + i();
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
                      top: `${globalIndex() * ROW_HEIGHT + wipShift()}px`,
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
        <div
          class="commit-graph__zone commit-graph__zone--graph"
          onWheel={forwardWheel}
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
                width: `${graphContentWidth()}px`,
                transform: `translateY(-${scrollTop()}px)`,
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
              <For each={visibleRows()}>
                {(r, i) => {
                  const globalIndex = () => visibleRange().start + i();
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
                        top: `${globalIndex() * ROW_HEIGHT + wipShift()}px`,
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
                        style={{
                          left: `${GUTTER + r.lane * LANE_WIDTH + LANE_WIDTH / 2}px`,
                        }}
                      />
                      <CommitRowGraph
                        row={r}
                        edges={edgeStates()[globalIndex()] ?? new Map()}
                        hostingService={hostingService()}
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
                transform: `translateY(-${scrollTop()}px)`,
              }}
            >
              <For each={visibleRows()}>
                {(r, i) => {
                  const globalIndex = () => visibleRange().start + i();
                  return (
                    <span
                      class="commit-graph__lane-streak"
                      style={{
                        top: `${globalIndex() * ROW_HEIGHT + (ROW_HEIGHT - 22) / 2 + wipShift()}px`,
                        "background-color": `var(--column-${r.color_idx % 10}-color)`,
                      }}
                    />
                  );
                }}
              </For>
            </div>
          </div>
        </div>
        <div
          class="commit-graph__zone commit-graph__zone--messages"
          ref={messagesScroll}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
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
            <For each={visibleRows()}>
              {(r, i) => {
                const globalIndex = () => visibleRange().start + i();
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
                      top: `${globalIndex() * ROW_HEIGHT + wipShift()}px`,
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
                    <span class="commit-graph__sha">{r.short_sha}</span>
                    <span class="commit-graph__summary">{r.summary}</span>
                    <span class="commit-graph__author">{r.author_name}</span>
                  </li>
                );
              }}
            </For>
          </ul>
        </div>
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
