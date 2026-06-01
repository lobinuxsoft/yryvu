// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createEffect,
  createMemo,
  onCleanup,
  onMount,
  type Accessor,
} from "solid-js";

import type { GraphRow } from "../../ipc";
import {
  activeColumnSettings,
  commitZoneMode,
  dirtyFileCount,
  pinnedSha,
} from "../../state";
import { getRenderDims } from "./RowRenderer";

/**
 * Sentinel sha for the synthetic working-directory row. Forty zeroes —
 * never a real Git object — so any sha-keyed lookup (selection, ref-nav,
 * edge target) naturally misses it. Exported so click handlers can detect
 * the WIP row by identity when a `node_type` check isn't in scope.
 */
export const WIP_SENTINEL_SHA = "0".repeat(40);

/**
 * Assemble the synthetic `WorkDir` row from the resolved HEAD row. Lane,
 * color, and the single parent edge are borrowed from HEAD so the WIP node
 * sits directly above the checked-out commit in HEAD's column. All identity
 * / author / committer fields are blank — the renderer special-cases this
 * row and never reads them.
 */
export function buildWorkDirRow(head: GraphRow): GraphRow {
  return {
    sha: WIP_SENTINEL_SHA,
    short_sha: "",
    summary: "",
    body: "",
    author_name: "",
    author_email: "",
    author_initials: "",
    gravatar_hash: "",
    author_date: 0,
    committer_name: null,
    committer_email: null,
    committer_date: null,
    committer_initials: null,
    committer_gravatar_hash: null,
    lane: head.lane,
    parent_lanes: [head.lane],
    parent_shas: [head.sha],
    color_idx: head.color_idx,
    refs: [],
    is_merge: false,
    node_type: "WorkDir",
    child_refs: { heads: [], remotes: [], tags: [] },
    active_lanes: [head.lane],
  };
}

interface LayoutOptions {
  rows: Accessor<GraphRow[]>;
  /** Total scroll content height from the virtualizer — supplied by caller. */
  virtualSize: Accessor<number>;
  /** Root DOM ref so we can write column-width CSS variables onto `.main`. */
  rootRef: () => HTMLDivElement | undefined;
}

/**
 * Layout-derived state for the commit graph: the WIP-aware display list,
 * total scroll height, max-lane / content-width, the HEAD-row resolution
 * chain, the WIP-node geometry, and the column-width CSS effects.
 *
 * Lives in its own hook so `index.tsx` doesn't sprawl with the (mostly
 * mechanical) memos and DOM-side effects that don't talk to the JSX
 * directly.
 */
export function useGraphLayout(opts: LayoutOptions) {
  // Number of synthetic rows prepended ahead of the real commit stream —
  // 0 or 1. Zones subtract this from a virtual item's index to recover the
  // matching `edgeStates()` entry (which is keyed by real-commit index).
  // The synthetic `WorkDir` row itself is assembled in `displayRows`
  // (defined below, after the HEAD-row resolution it borrows lane/color from).
  const wipOffset = () => (dirtyFileCount() > 0 ? 1 : 0);
  const totalHeight = () => opts.virtualSize();

  /* Graph-column intrinsic width (#141 follow-up) — when the repo fans out
   * beyond the GRAPH cell's viewport width, lanes disappear off the right
   * edge. GitKraken solves this by letting the commitZone be the only
   * zone without a `maximumWidth`: the column renders at its natural
   * `numGraphColumns * columnWidth` and the container scrolls horizontally
   * when it exceeds the cell. We get the same effect by sizing an inner
   * wrapper to the natural content width and putting `overflow-x: auto`
   * on the cell.
   *
   * `maxLane` walks rows + parent_lanes only (O(n·k)). Pass-through edges
   * never visit a lane that didn't start as a `row.lane` or `parent_lane`
   * somewhere in the walk, so this upper-bounds the active-lane set
   * correctly without touching edgeStates. */
  const maxLane = createMemo(() => {
    let max = 0;
    const all = opts.rows();
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
  onMount(() => {
    const main = opts.rootRef()?.closest(".main") as HTMLElement | null;
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
  // placeholder label.
  //
  // The previous heuristic (`rows()[0]`) was wrong on repos where the
  // youngest commit by committer-time belongs to a different branch
  // than HEAD — the WIP node anchored to the topmost row's lane
  // instead of the checked-out branch's lane. Eggscape repro: HEAD on
  // `4236-fix-frameo-en-casco` (lane = green column), top row is
  // `prueba loca` on `origin/feature-visu…` (lane 0 = blue). WIP cell
  // used to land on lane 0 instead of green.
  //
  // Resolution priority — matches the spirit of `pick_pinned_head`
  // backend-side: explicit `Head` ref → pinned trunk fallback →
  // topmost row as last resort (detached HEAD with no resolvable pin).
  const headRow = createMemo(() => {
    const all = opts.rows();
    const withHead = all.find((r) =>
      r.refs.some((ref) => ref.kind === "Head"),
    );
    if (withHead) return withHead;
    const pin = pinnedSha();
    if (pin) {
      const pinned = all.find((r) => r.sha === pin);
      if (pinned) return pinned;
    }
    return all[0];
  });
  const headLane = createMemo(() => headRow()?.lane ?? 0);
  const headColorIdx = createMemo(() => (headRow()?.color_idx ?? 0) % 10);
  const headBranchName = createMemo(
    () => headRow()?.refs.find((r) => r.kind === "Head")?.name,
  );
  const wipNodeX = () => {
    const dims = getRenderDims(commitZoneMode() === "compact");
    return dims.gutter + headLane() * dims.laneWidth + dims.laneWidth / 2;
  };

  /**
   * Index of the HEAD-bearing row inside `rows()`. Drives the WIP-to-HEAD
   * dashed connector — the line walks from the WIP cell at row 0 down to
   * the HEAD commit's circle, regardless of how many rows separate them.
   * `-1` means HEAD is not in the current view (filtered, off-stream, or
   * detached without a pinned-trunk fallback) — caller hides the connector.
   */
  const headRowIndex = createMemo(() => {
    const all = opts.rows();
    const head = headRow();
    if (!head) return -1;
    return all.indexOf(head);
  });

  // GK's `getCommitOrderWithWipNode = compact(concat(wip, order))` selector,
  // ported reactively: prepend a synthetic `WorkDir` row when the tree is
  // dirty so the WIP flows through the same virtualized `<For>` as commits.
  // `opts.rows()` stays commit-only — the incremental edge builder (#141)
  // never sees the prepended row, keeping its append-only invariant.
  const displayRows = createMemo<GraphRow[]>(() => {
    const base = opts.rows();
    if (dirtyFileCount() === 0) return base;
    const head = headRow();
    if (!head) return base;
    return [buildWorkDirRow(head), ...base];
  });

  return {
    wipOffset,
    displayRows,
    totalHeight,
    graphContentWidth,
    headRow,
    headLane,
    headColorIdx,
    headBranchName,
    wipNodeX,
    headRowIndex,
  };
}

export type GraphLayout = ReturnType<typeof useGraphLayout>;
