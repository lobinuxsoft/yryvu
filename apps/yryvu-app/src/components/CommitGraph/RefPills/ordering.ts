// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChildRefs, RefTag } from "../../../ipc/commits";
import { refKey } from "../../../branchOps";

/**
 * Map a ref-tag `kind` (backend enum) to the `HoveredRef.kind` channel used
 * by the hover-dim pass. The backend splits remote branches and tags into
 * their own buckets; the dim test indexes by these three buckets.
 */
export function hoveredKindFor(
  kind: RefTag["kind"],
): "head" | "remote" | "tag" {
  switch (kind) {
    case "Head":
    case "Branch":
      return "head";
    case "RemoteBranch":
      return "remote";
    case "Tag":
      return "tag";
  }
}

/**
 * Type priority for ordering within a row — higher sorts first.
 * Matches doc 06: WORKTREE(3) > HEAD(2) > REMOTE(1) > TAG(0). Local Branch
 * co-equal with Head at 2 since we don't have a separate worktree kind.
 */
export function typePriority(kind: RefTag["kind"]): number {
  switch (kind) {
    case "Head":
      return 3;
    case "Branch":
      return 2;
    case "RemoteBranch":
      return 1;
    case "Tag":
      return 0;
  }
}

/**
 * Three-stage ordering per doc 06:
 *   1. HEAD (checked-out) first.
 *   2. Pinned-branch group next — only applies on the pinned row, where
 *      the local branch matching the pinned head sha is promoted.
 *   3. Type priority desc, then alphabetical by name.
 */
export function orderRefs(refs: RefTag[], pinnedRow: boolean): RefTag[] {
  return [...refs].sort((a, b) => {
    if (a.kind === "Head" && b.kind !== "Head") return -1;
    if (b.kind === "Head" && a.kind !== "Head") return 1;
    if (pinnedRow) {
      if (a.kind === "Branch" && b.kind !== "Branch") return -1;
      if (b.kind === "Branch" && a.kind !== "Branch") return 1;
    }
    const p = typePriority(b.kind) - typePriority(a.kind);
    if (p !== 0) return p;
    return a.name.localeCompare(b.name);
  });
}

/** Synthesize a minimal RefTag for ghost rendering — no upstream data. */
function ghostTag(name: string, kind: RefTag["kind"]): RefTag {
  return { name, kind, upstream: null, ahead: 0, behind: 0 };
}

/**
 * Build the ghost ref list for a row: refs that pass through this commit
 * but don't tip here. Sourced from `child_refs` (populated bottom-up in
 * graph-core), minus refs that already render as real pills, minus
 * user-hidden refs.
 */
export function ghostRefsFor(
  childRefs: ChildRefs,
  liveRefs: RefTag[],
  hidden: Set<string>,
): RefTag[] {
  const liveByBucket = {
    head: new Set<string>(),
    remote: new Set<string>(),
    tag: new Set<string>(),
  };
  for (const r of liveRefs) {
    liveByBucket[hoveredKindFor(r.kind)].add(r.name);
  }
  const out: RefTag[] = [];
  for (const name of childRefs.heads) {
    if (liveByBucket.head.has(name)) continue;
    const tag = ghostTag(name, "Branch");
    if (hidden.has(refKey(tag))) continue;
    out.push(tag);
  }
  for (const name of childRefs.remotes) {
    if (liveByBucket.remote.has(name)) continue;
    const tag = ghostTag(name, "RemoteBranch");
    if (hidden.has(refKey(tag))) continue;
    out.push(tag);
  }
  for (const name of childRefs.tags) {
    if (liveByBucket.tag.has(name)) continue;
    const tag = ghostTag(name, "Tag");
    if (hidden.has(refKey(tag))) continue;
    out.push(tag);
  }
  return out;
}
