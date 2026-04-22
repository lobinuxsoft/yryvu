// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Literal port of GitKraken's `getFinalEdgeStateForGraphAndRow` +
 * `getEndingAndPassThroughEdgesByColumnFromPrevRow` +
 * `getStartingEdgesByColumn` from
 * `@gitkraken/gitkraken-components/dist/index.js` (recovered 2026-04-22 from
 * the extracted GitKraken Desktop app; visible in the deminified fragment
 * in `CommitGraph/RowRenderer.tsx`'s top comment).
 *
 * For each row produces a **dict keyed by column** where each entry holds
 * up to three edge-kind slots: `starting`, `passThrough`, `ending`. The
 * renderer iterates this dict per-row and dispatches to one of three
 * drawing functions — same model as GK's inner render loop at bundle
 * offset ~242000.
 *
 * The dict is propagated forward row-by-row: every edge that existed in
 * the previous row's entry (as `starting` or `passThrough`) carries over
 * into the next row as either `ending` (if its `parentSha` matches the
 * next commit's sha) or `passThrough` (otherwise). Starting edges for
 * the current commit's parents are then layered on top.
 *
 * First-parent (index 0) is placed at the **commit's column**; extra
 * parents (merges, index > 0) are placed at the **parent's column**.
 * That difference is what makes first-parent-at-different-lane render
 * as an ENDING cross-column edge in the parent's row (edge travels in
 * the child's column), while merge extra parents render as STARTING
 * cross-column edges in the merge commit's row (edge leaves the
 * commit and arcs over to the parent's column).
 */

import type { GraphRow } from "../../ipc";

export interface EdgeInfo {
  /** The sha this edge is heading toward. Used to detect when the edge
   *  should convert to an `ending` in the target's row. */
  parentSha: string;
}

export interface RowEdgeCell {
  starting?: EdgeInfo;
  passThrough?: EdgeInfo;
  ending?: EdgeInfo;
}

/** Map from column index → {starting?, passThrough?, ending?}. */
export type RowEdges = Map<number, RowEdgeCell>;

/**
 * Build per-row edges dict for the whole commit stream. O(n·k) where k is
 * the average number of live edges per row — linear in total live-edges
 * over the whole walk.
 */
export function buildEdgeStates(rows: GraphRow[]): RowEdges[] {
  const result: RowEdges[] = [];
  let prev: RowEdges = new Map();

  for (const row of rows) {
    const current: RowEdges = new Map();

    // Step 1 — propagate previous row's live edges into this row.
    // GK's `getEndingAndPassThroughEdgesByColumnFromPrevRow` prefers
    // `passThrough` over `starting` when both exist (for cross-row
    // continuity); we do the same with `?? cell.starting`.
    for (const [col, cell] of prev.entries()) {
      const carry: EdgeInfo | undefined = cell.passThrough ?? cell.starting;
      if (!carry) continue;
      const entry: RowEdgeCell = current.get(col) ?? {};
      if (carry.parentSha === row.sha) {
        entry.ending = carry;
      } else {
        entry.passThrough = carry;
      }
      current.set(col, entry);
    }

    // Step 2 — emit starting edges for this commit's parents.
    // First-parent goes in the commit's own column (continuation of the
    // same logical branch); extra parents go in each parent's column
    // (new branch fan-out).
    if (row.parent_shas.length > 0) {
      const firstParentSha = row.parent_shas[0];
      if (firstParentSha !== undefined) {
        const firstEntry: RowEdgeCell = current.get(row.lane) ?? {};
        firstEntry.starting = { parentSha: firstParentSha };
        current.set(row.lane, firstEntry);
      }
      for (let i = 1; i < row.parent_shas.length; i += 1) {
        const parentSha = row.parent_shas[i];
        const parentCol = row.parent_lanes[i];
        if (parentSha === undefined || parentCol === undefined) continue;
        const entry: RowEdgeCell = current.get(parentCol) ?? {};
        entry.starting = { parentSha };
        current.set(parentCol, entry);
      }
    }

    result.push(current);
    prev = current;
  }

  return result;
}
