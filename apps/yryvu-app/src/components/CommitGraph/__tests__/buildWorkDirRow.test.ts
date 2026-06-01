// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import type { GraphRow } from "../../../ipc";
import { buildWorkDirRow, WIP_SENTINEL_SHA } from "../useGraphLayout";

function headRow(over: Partial<GraphRow> = {}): GraphRow {
  return {
    sha: "1111111111111111111111111111111111111111",
    short_sha: "1111111",
    summary: "feat: head",
    body: "",
    author_name: "Alice Example",
    author_email: "alice@example.com",
    author_initials: "AE",
    gravatar_hash: "x",
    author_date: 1_700_000_000,
    committer_name: "Alice Example",
    committer_email: "alice@example.com",
    committer_date: 1_700_000_000,
    committer_initials: "AE",
    committer_gravatar_hash: "x",
    lane: 3,
    parent_lanes: [3],
    parent_shas: ["2222222222222222222222222222222222222222"],
    color_idx: 7,
    refs: [{ name: "main", kind: "Head", upstream: null, ahead: 0, behind: 0 }],
    is_merge: false,
    node_type: "Commit",
    child_refs: { heads: [], remotes: [], tags: [] },
    active_lanes: [3],
    ...over,
  };
}

describe("buildWorkDirRow", () => {
  it("borrows lane and color from HEAD", () => {
    const wip = buildWorkDirRow(headRow({ lane: 5, color_idx: 2 }));
    expect(wip.lane).toBe(5);
    expect(wip.color_idx).toBe(2);
  });

  it("parents the synthetic row on HEAD in HEAD's lane", () => {
    const head = headRow();
    const wip = buildWorkDirRow(head);
    expect(wip.parent_shas).toEqual([head.sha]);
    expect(wip.parent_lanes).toEqual([head.lane]);
    expect(wip.active_lanes).toEqual([head.lane]);
  });

  it("tags the row WorkDir with the sentinel sha and no refs", () => {
    const wip = buildWorkDirRow(headRow());
    expect(wip.node_type).toBe("WorkDir");
    expect(wip.sha).toBe(WIP_SENTINEL_SHA);
    expect(wip.sha).toBe("0".repeat(40));
    expect(wip.refs).toEqual([]);
    expect(wip.is_merge).toBe(false);
    expect(wip.summary).toBe("");
  });

  it("does not inherit HEAD's identity / refs", () => {
    const wip = buildWorkDirRow(headRow());
    expect(wip.author_name).toBe("");
    expect(wip.short_sha).toBe("");
    expect(wip.committer_name).toBeNull();
  });
});
