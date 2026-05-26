// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Membership test for GitKraken's hover-dim behaviour (issue #54).
 *
 * Given a row and the currently-hovered ref, return `true` iff the row is
 * reachable from (i.e., an ancestor of or equal to) the ref's tip. Rows
 * that are **not** members get the `dimmed-row` CSS class applied.
 *
 * Backend pre-work: `graph-core::populate_child_refs` (merged in #118)
 * walks the DAG once, bottom-up, propagating each row's own ref-name sets
 * up into its parents' `child_refs` buckets. At render time, the test is
 * O(1): check the row's own `refs` first, then the `child_refs` bucket
 * for the same kind. No on-hover DAG traversal — matches GitKraken's
 * `isMissingHoveredRefGroup` selector (doc 08 / bundle `Gd`).
 *
 * Why `head` vs `remote` vs `tag` buckets? GitKraken segregates them so a
 * hover on `origin/main` doesn't also light up `main` (the local branch
 * may point to a different commit when the branch is out-of-sync with
 * its remote).
 */

import type { GraphRow, RefTag } from "../../ipc";
import type { HoveredRef } from "../../state";

function matchesOwnRef(refs: RefTag[], hovered: HoveredRef): boolean {
  for (const r of refs) {
    if (r.name !== hovered.name) continue;
    // Map backend's kind to the hovered-ref bucket. Local branches and
    // HEAD share the `head` bucket; remote-branch and tag each have their
    // own — same split as `child_refs`.
    const bucket =
      r.kind === "Head" || r.kind === "Branch"
        ? "head"
        : r.kind === "RemoteBranch"
          ? "remote"
          : "tag";
    if (bucket === hovered.kind) return true;
  }
  return false;
}

export function isRowMemberOfHoveredRef(
  row: GraphRow,
  hovered: HoveredRef | undefined,
): boolean {
  // No ref hovered → everyone's a member (no dim).
  if (!hovered) return true;
  // Row's own refs take precedence over `child_refs` — a row that IS the
  // hovered ref's tip always matches, even if its `child_refs` bucket
  // happens to be empty (tip itself has no descendants in the slice).
  if (matchesOwnRef(row.refs, hovered)) return true;
  // Fall back to the pre-computed descendant set. `child_refs[bucket]`
  // contains every ref-name reachable from this row's strict descendants
  // at that bucket.
  const bucket =
    hovered.kind === "head"
      ? row.child_refs.heads
      : hovered.kind === "remote"
        ? row.child_refs.remotes
        : row.child_refs.tags;
  return bucket.includes(hovered.name);
}

import {
  matchesCommitFilterWithPath,
  type CommitFilter,
} from "../../state/commit-filter";

/// Combined dim test (issue #111). A row is dimmed when:
///
/// - A ref is hovered AND the row is NOT a member of that ref's
///   descendant set; OR
/// - Any commit-filter chip is active AND the row doesn't satisfy
///   every chip (AND semantics).
///
/// The two predicates compose with OR — failing either one dims the
/// row. Returns `true` when the row should render at full opacity.
export function isRowVisible(
  row: GraphRow,
  hovered: HoveredRef | undefined,
  filter: CommitFilter,
  pathSet: Set<string> | null | undefined,
): boolean {
  if (!isRowMemberOfHoveredRef(row, hovered)) return false;
  if (!matchesCommitFilterWithPath(row, filter, pathSet)) return false;
  return true;
}
