// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  collapsedRemoteFolders,
  toggleRemoteFolderCollapsed,
} from "../remoteFolders";

const REPO_A = "/repos/a";
const REPO_B = "/repos/b";

describe("remoteFolders state", () => {
  it("defaults to expanded (empty collapsed set)", () => {
    expect(collapsedRemoteFolders("/repos/fresh").size).toBe(0);
  });

  it("toggle collapses then re-expands a folder", () => {
    toggleRemoteFolderCollapsed(REPO_A, "origin");
    expect(collapsedRemoteFolders(REPO_A).has("origin")).toBe(true);
    toggleRemoteFolderCollapsed(REPO_A, "origin");
    expect(collapsedRemoteFolders(REPO_A).has("origin")).toBe(false);
  });

  it("scopes collapse state per repo — no cross-repo leak", () => {
    toggleRemoteFolderCollapsed(REPO_A, "upstream");
    expect(collapsedRemoteFolders(REPO_A).has("upstream")).toBe(true);
    expect(collapsedRemoteFolders(REPO_B).has("upstream")).toBe(false);
    toggleRemoteFolderCollapsed(REPO_A, "upstream");
  });

  it("persists to localStorage sparsely (expanded entries dropped)", () => {
    toggleRemoteFolderCollapsed(REPO_A, "origin");
    const raw = localStorage.getItem("yryvu.collapsedRemoteFolders");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ [REPO_A]: ["origin"] });
    toggleRemoteFolderCollapsed(REPO_A, "origin");
    expect(JSON.parse(localStorage.getItem("yryvu.collapsedRemoteFolders")!)).toEqual(
      {},
    );
  });
});
