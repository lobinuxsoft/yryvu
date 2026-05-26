// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import type { GraphRow } from "../../ipc";
import {
  EMPTY_FILTER,
  isFilterEmpty,
  matchesCommitFilter,
  matchesCommitFilterWithPath,
} from "../commit-filter";

function row(over: Partial<GraphRow> = {}): GraphRow {
  return {
    sha: "abcdef1234567890abcdef1234567890abcdef12",
    short_sha: "abcdef1",
    summary: "Initial commit",
    body: "",
    author_name: "Alice Example",
    author_email: "alice@example.com",
    author_initials: "AE",
    gravatar_hash: "x",
    author_date: 1_700_000_000,
    committer_name: "Alice",
    committer_email: "alice@example.com",
    committer_date: 1_700_000_000,
    parents: [],
    refs: [],
    child_refs: { heads: [], remotes: [], tags: [] },
    is_wip: false,
    is_pinned_trunk: false,
    column: 0,
    lane_count: 1,
    pass_through_columns: [],
    incoming_edges: [],
    outgoing_edges: [],
    ...over,
  } as unknown as GraphRow;
}

describe("isFilterEmpty", () => {
  it("returns true for the empty preset", () => {
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true);
  });
  it("returns false when any single chip is set", () => {
    expect(isFilterEmpty({ ...EMPTY_FILTER, author: "a" })).toBe(false);
    expect(isFilterEmpty({ ...EMPTY_FILTER, dateFrom: 1 })).toBe(false);
  });
});

describe("matchesCommitFilter", () => {
  it("matches every row when filter is empty", () => {
    expect(matchesCommitFilter(row(), EMPTY_FILTER)).toBe(true);
  });

  it("author chip matches name OR email (case-insensitive)", () => {
    expect(matchesCommitFilter(row(), { ...EMPTY_FILTER, author: "alice" })).toBe(true);
    expect(matchesCommitFilter(row(), { ...EMPTY_FILTER, author: "EXAMPLE" })).toBe(true);
    expect(matchesCommitFilter(row(), { ...EMPTY_FILTER, author: "bob" })).toBe(false);
  });

  it("message chip searches summary + body (case-insensitive)", () => {
    const r = row({ summary: "Fix bug", body: "And more lines" });
    expect(matchesCommitFilter(r, { ...EMPTY_FILTER, message: "fix" })).toBe(true);
    expect(matchesCommitFilter(r, { ...EMPTY_FILTER, message: "MORE" })).toBe(true);
    expect(matchesCommitFilter(r, { ...EMPTY_FILTER, message: "zzz" })).toBe(false);
  });

  it("shaPrefix matches with case-insensitive prefix", () => {
    expect(matchesCommitFilter(row(), { ...EMPTY_FILTER, shaPrefix: "ABC" })).toBe(true);
    expect(matchesCommitFilter(row(), { ...EMPTY_FILTER, shaPrefix: "abcdef" })).toBe(true);
    expect(matchesCommitFilter(row(), { ...EMPTY_FILTER, shaPrefix: "ffff" })).toBe(false);
  });

  it("date range is inclusive on both ends", () => {
    const at = row({ author_date: 100 });
    expect(matchesCommitFilter(at, { ...EMPTY_FILTER, dateFrom: 100 })).toBe(true);
    expect(matchesCommitFilter(at, { ...EMPTY_FILTER, dateFrom: 101 })).toBe(false);
    expect(matchesCommitFilter(at, { ...EMPTY_FILTER, dateTo: 100 })).toBe(true);
    expect(matchesCommitFilter(at, { ...EMPTY_FILTER, dateTo: 99 })).toBe(false);
  });

  it("composes with AND across multiple chips", () => {
    expect(
      matchesCommitFilter(row(), {
        ...EMPTY_FILTER,
        author: "alice",
        message: "initial",
      }),
    ).toBe(true);
    expect(
      matchesCommitFilter(row(), {
        ...EMPTY_FILTER,
        author: "alice",
        message: "missing-substring",
      }),
    ).toBe(false);
  });
});

describe("matchesCommitFilterWithPath", () => {
  it("returns true when no path filter active", () => {
    expect(matchesCommitFilterWithPath(row(), EMPTY_FILTER, undefined)).toBe(true);
  });

  it("rejects every row while path set is loading (null)", () => {
    expect(
      matchesCommitFilterWithPath(row(), { ...EMPTY_FILTER, path: "x" }, null),
    ).toBe(false);
  });

  it("uses path set membership when loaded", () => {
    const set = new Set([row().sha]);
    expect(
      matchesCommitFilterWithPath(row(), { ...EMPTY_FILTER, path: "x" }, set),
    ).toBe(true);
    expect(
      matchesCommitFilterWithPath(
        row({ sha: "z".repeat(40) }),
        { ...EMPTY_FILTER, path: "x" },
        set,
      ),
    ).toBe(false);
  });
});
