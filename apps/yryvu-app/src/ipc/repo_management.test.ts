// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  rehydrateBatch,
  repoNameFromPath,
  type KnownReposBatch,
} from "./repo_management";

describe("repoNameFromPath", () => {
  it("takes the last segment of a POSIX path", () => {
    expect(repoNameFromPath("/home/me/src/yryvu")).toBe("yryvu");
  });

  it("takes the last segment of a Windows path", () => {
    expect(repoNameFromPath("C:\\src\\yryvu")).toBe("yryvu");
  });

  it("ignores a trailing separator", () => {
    expect(repoNameFromPath("/home/me/src/yryvu/")).toBe("yryvu");
  });

  it("falls back to the whole string when there is no segment", () => {
    expect(repoNameFromPath("/")).toBe("/");
  });
});

describe("rehydrateBatch", () => {
  const batch: KnownReposBatch = {
    paths: ["/a/one", "/b/two", "/c/three"],
    branches: ["main", null, "dev"],
    dirtyCounts: [0, 5, 2],
    errors: [null, "open: gone", null],
  };

  it("keeps every column index-aligned to its path", () => {
    const rows = rehydrateBatch(batch);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      path: "/b/two",
      name: "two",
      currentBranch: null,
      dirtyCount: 5,
      error: "open: gone",
    });
  });

  it("derives name and precomputes a lowercased searchKey", () => {
    const [row] = rehydrateBatch(batch);
    expect(row.name).toBe("one");
    // name + path + branch, all lowercased, so the filter is a pure
    // substring test.
    expect(row.searchKey).toBe("one\n/a/one\nmain");
    expect(row.searchKey).toBe(row.searchKey.toLowerCase());
  });

  it("searchKey matches on branch and path, not just name", () => {
    const rows = rehydrateBatch(batch);
    const byBranch = rows.filter((r) => r.searchKey.includes("dev"));
    expect(byBranch).toHaveLength(1);
    expect(byBranch[0].path).toBe("/c/three");
  });

  it("degrades a short column to per-slot defaults instead of throwing", () => {
    // A corrupt snapshot: fewer branches/errors than paths.
    const truncated: KnownReposBatch = {
      paths: ["/a/one", "/b/two"],
      branches: ["main"],
      dirtyCounts: [1],
      errors: [],
    };
    const rows = rehydrateBatch(truncated);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      currentBranch: null,
      dirtyCount: 0,
      error: null,
    });
  });
});
