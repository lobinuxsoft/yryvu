// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createSignal, on, Show } from "solid-js";

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { createVirtualizer } from "@tanstack/solid-virtual";

import {
  clearPendingRefNav,
  dirtyFileCount,
  inspectorMode,
  pendingRefNav,
  setInspectorMode,
  setSelectedCommit,
} from "../../state";
import { ContextMenu } from "../ContextMenu";
import { CommitDialogs } from "./CommitDialogs";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { createCommitOps } from "./useCommitOps";
import { ROW_HEIGHT } from "./RowRenderer";
import { useGraphData } from "./useGraphData";
import { useGraphLayout } from "./useGraphLayout";
import { useGraphSelection } from "./useGraphSelection";
import { BranchZone } from "./zones/BranchZone";
import { GraphZone } from "./zones/GraphZone";
import { MessageZone } from "./zones/MessageZone";
import { MetaZones } from "./zones/MetaZones";
import type { ZoneDeps } from "./zones/types";

export interface CommitGraphProps {
  repoPath: string;
}

const OVERSCAN_ROWS = 8;

/**
 * Commit graph composer. Wires the per-domain hooks (data / layout /
 * selection) plus the virtualizer + commit ops, and dispatches each
 * zone to its own component file.
 *
 * Scroll architecture: the `.commit-graph__zones` container is the
 * single source of vertical scroll. All zones consume the same
 * virtualizer's `getVirtualItems()` so a commit's row across
 * BRANCH/TAG / GRAPH / MESSAGE / AUTHOR / DATE-TIME / SHA stays at the
 * same `start` offset.
 */
export function CommitGraph(props: CommitGraphProps) {
  let rootEl: HTMLDivElement | undefined;
  let zonesScroll: HTMLDivElement | undefined;

  const [hoveredCommit, setHoveredCommit] = createSignal<string | undefined>(
    undefined,
  );

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

  const data = useGraphData(() => props.repoPath);

  // Vertical virtualizer 1:1 with GK's `MultiGrid` (which underlies its
  // graph view in `react-virtualized`). Single instance shared across
  // every visible zone.
  const virtualizer = createVirtualizer({
    get count() {
      return data.rows().length;
    },
    getScrollElement: () => zonesScroll ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  });

  const layout = useGraphLayout({
    rows: data.rows,
    virtualSize: () => virtualizer.getTotalSize(),
    rootRef: () => rootEl,
  });
  const selection = useGraphSelection({ rows: data.rows });

  // Sidebar ref-click navigation (issue #72). Mirrors GK's `setScrollToSha`:
  // resolve the requested sha to a row index, scroll only when off-screen
  // (`align: "center"`), and update the selection ring. The signal is
  // request-shaped (with a bumping `seq`) so two clicks on the same ref
  // re-fire even though the sha is unchanged.
  createEffect(
    on(pendingRefNav, (req) => {
      if (!req) return;
      const rows = data.rows();
      const idx = rows.findIndex((r) => r.sha === req.sha);
      if (idx < 0) {
        clearPendingRefNav();
        return;
      }
      const scroller = zonesScroll;
      if (scroller) {
        const rowTop = idx * ROW_HEIGHT;
        const rowBottom = rowTop + ROW_HEIGHT;
        const viewTop = scroller.scrollTop;
        const viewBottom = viewTop + scroller.clientHeight;
        const fullyVisible = rowTop >= viewTop && rowBottom <= viewBottom;
        if (!fullyVisible) {
          virtualizer.scrollToIndex(idx, { align: "center" });
        }
      }
      setSelectedCommit(req.sha);
      if (inspectorMode() !== "details") setInspectorMode("details");
      clearPendingRefNav();
    }),
  );

  const deps: ZoneDeps = {
    rows: data.rows,
    hostingService: data.hostingService,
    edgeStates: data.edgeStates,
    virtualizer,
    layout,
    selection,
    hoveredCommit,
    setHoveredCommit,
    openCommitContextMenu: (e, sha, shortSha) =>
      ops.openCommitContextMenu(e, sha, shortSha),
  };

  const isInitialLoading = () => data.loading() && data.rows().length === 0;

  return (
    <div
      class="commit-graph"
      ref={rootEl}
      data-loading={isInitialLoading() ? "true" : "false"}
    >
      <Show when={data.error()}>
        <div class="commit-graph__error">Error: {data.error()}</div>
      </Show>
      <Show when={isInitialLoading()}>
        <LoadingSkeleton topOffset={dirtyFileCount() > 0 ? ROW_HEIGHT : 0} />
      </Show>
      {/* WIP pseudo-row architecture mirrors GitKraken exactly: each
          zone injects its own WIP cell at index 0 inside the same
          scroll-synced coordinate system. See zones/*.tsx. */}
      <div class="commit-graph__zones" ref={zonesScroll}>
        <BranchZone deps={deps} />
        <GraphZone deps={deps} />
        <MessageZone deps={deps} />
        <MetaZones deps={deps} />
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
