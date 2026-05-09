// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { filterByTitle, titleOf } from "../tabTitle";
import { type Tab } from "../../../tabs/types";

function repo(repoPath: string, id = "id"): Tab {
  return { type: "REPO", id, repoPath, isWorktree: false };
}

describe("titleOf", () => {
  it("REPO uses the last path segment", () => {
    expect(titleOf(repo("/var/mnt/DATA/Repos/yryvu"))).toBe("yryvu");
    expect(titleOf(repo("/Users/foo/Code/oh-my-engine"))).toBe("oh-my-engine");
  });

  it("REPO falls back to 'Repo' when the path is empty / root", () => {
    expect(titleOf(repo("/"))).toBe("Repo");
    expect(titleOf(repo(""))).toBe("Repo");
  });

  it("NEW returns 'New Tab'", () => {
    expect(titleOf({ type: "NEW", id: "x" })).toBe("New Tab");
  });

  it("RELEASE_NOTES returns 'Release Notes'", () => {
    expect(
      titleOf({ type: "RELEASE_NOTES", id: "x", version: "0.4.2" }),
    ).toBe("Release Notes");
  });
});

describe("filterByTitle", () => {
  const items = [
    repo("/var/mnt/DATA/Repos/yryvu", "a"),
    repo("/var/mnt/DATA/Repos/oh-my-engine", "b"),
    repo("/var/mnt/DATA/Repos/CapyDeploy", "c"),
    { type: "NEW", id: "n" } as Tab,
    { type: "RELEASE_NOTES", id: "r", version: "0.4.2" } as Tab,
  ];

  it("passes everything through with empty query", () => {
    expect(filterByTitle(items, titleOf, "").length).toBe(5);
    expect(filterByTitle(items, titleOf, "   ").length).toBe(5);
  });

  it("case-insensitive substring match", () => {
    expect(filterByTitle(items, titleOf, "yryvu").map((t) => t.id)).toEqual([
      "a",
    ]);
    expect(filterByTitle(items, titleOf, "YRYVU").map((t) => t.id)).toEqual([
      "a",
    ]);
    expect(filterByTitle(items, titleOf, "Engine").map((t) => t.id)).toEqual([
      "b",
    ]);
  });

  it("matches across all tab types", () => {
    expect(filterByTitle(items, titleOf, "release").map((t) => t.id)).toEqual([
      "r",
    ]);
    expect(filterByTitle(items, titleOf, "new").map((t) => t.id)).toEqual([
      "n",
    ]);
  });

  it("returns empty array when nothing matches", () => {
    expect(filterByTitle(items, titleOf, "zzz")).toEqual([]);
  });

  it("supports custom title extractor (e.g. ClosedTab.tab)", () => {
    interface Wrapper {
      id: string;
      inner: Tab;
    }
    const wrapped: Wrapper[] = [
      { id: "x", inner: repo("/foo/bar") },
      { id: "y", inner: repo("/foo/baz") },
    ];
    const out = filterByTitle(wrapped, (w) => titleOf(w.inner), "bar");
    expect(out.map((w) => w.id)).toEqual(["x"]);
  });
});
