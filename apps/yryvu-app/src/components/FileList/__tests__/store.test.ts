// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  collapseAllDirs,
  expandAllDirs,
  hasAnyCollapsed,
  isDirCollapsed,
  resetRevState,
  toggleDirCollapsed,
} from "../store";

const TREE = true;
const DIRS = ["src", "src/components", "src/state"];

// Module-level store is singleton; tests use distinct (repoId, revKey)
// triples so they can't pollute each other.
const repo = (n: number) => `/tmp/yryvu-store-test-${n}`;

describe("FileList/store collapse-all cycle (issue #325)", () => {
  it("starts with no collapsed dirs and label 'Collapse All'", () => {
    const id = repo(1);
    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(false);
    for (const d of DIRS) {
      expect(isDirCollapsed(id, "unstaged", TREE, d)).toBe(false);
    }
  });

  it("Expand → Collapse → Expand → Collapse cycles forever (regression for desync bug)", () => {
    const id = repo(2);

    // Cycle 1: Collapse All
    collapseAllDirs(id, "unstaged", TREE, DIRS);
    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(true);
    for (const d of DIRS) {
      expect(isDirCollapsed(id, "unstaged", TREE, d)).toBe(true);
    }

    // Cycle 1: Expand All
    expandAllDirs(id, "unstaged", TREE);
    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(false);
    for (const d of DIRS) {
      expect(isDirCollapsed(id, "unstaged", TREE, d)).toBe(false);
    }

    // Cycle 2: Collapse All — pre-fix this stalled
    collapseAllDirs(id, "unstaged", TREE, DIRS);
    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(true);
    for (const d of DIRS) {
      expect(isDirCollapsed(id, "unstaged", TREE, d)).toBe(true);
    }

    // Cycle 2: Expand All
    expandAllDirs(id, "unstaged", TREE);
    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(false);
  });

  it("toggle on one dir leaves siblings untouched", () => {
    const id = repo(3);
    toggleDirCollapsed(id, "unstaged", TREE, "src");

    expect(isDirCollapsed(id, "unstaged", TREE, "src")).toBe(true);
    expect(isDirCollapsed(id, "unstaged", TREE, "src/components")).toBe(false);
    expect(isDirCollapsed(id, "unstaged", TREE, "src/state")).toBe(false);
    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(true);
  });

  it("toggle twice returns to expanded", () => {
    const id = repo(4);
    toggleDirCollapsed(id, "unstaged", TREE, "src");
    toggleDirCollapsed(id, "unstaged", TREE, "src");

    expect(isDirCollapsed(id, "unstaged", TREE, "src")).toBe(false);
    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(false);
  });

  it("collapse of UNSTAGED does not leak into STAGED (per-rev isolation)", () => {
    const id = repo(5);
    collapseAllDirs(id, "unstaged", TREE, DIRS);

    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(true);
    expect(hasAnyCollapsed(id, "staged", TREE)).toBe(false);
    for (const d of DIRS) {
      expect(isDirCollapsed(id, "staged", TREE, d)).toBe(false);
    }
  });

  it("expand of UNSTAGED does not leak into STAGED", () => {
    const id = repo(6);
    collapseAllDirs(id, "staged", TREE, DIRS);
    expandAllDirs(id, "unstaged", TREE);

    expect(hasAnyCollapsed(id, "staged", TREE)).toBe(true);
    expect(isDirCollapsed(id, "staged", TREE, "src")).toBe(true);
  });

  it("tree-mode collapse does not leak into flat-mode key", () => {
    const id = repo(7);
    collapseAllDirs(id, "unstaged", TREE, DIRS);

    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(true);
    expect(hasAnyCollapsed(id, "unstaged", false)).toBe(false);
  });

  it("resetRevState wipes only the targeted (id, rev, isTree) key", () => {
    const id = repo(8);
    collapseAllDirs(id, "unstaged", TREE, DIRS);
    collapseAllDirs(id, "staged", TREE, DIRS);

    resetRevState(id, "unstaged", TREE);

    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(false);
    expect(hasAnyCollapsed(id, "staged", TREE)).toBe(true);
  });

  it("expandAll after partial toggle clears all collapsed entries", () => {
    const id = repo(9);
    toggleDirCollapsed(id, "unstaged", TREE, "src");
    toggleDirCollapsed(id, "unstaged", TREE, "src/components");
    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(true);

    expandAllDirs(id, "unstaged", TREE);

    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(false);
    expect(isDirCollapsed(id, "unstaged", TREE, "src")).toBe(false);
    expect(isDirCollapsed(id, "unstaged", TREE, "src/components")).toBe(false);
  });

  it("collapseAll then toggling a single dir flips that dir back to expanded", () => {
    const id = repo(10);
    collapseAllDirs(id, "unstaged", TREE, DIRS);
    expect(isDirCollapsed(id, "unstaged", TREE, "src")).toBe(true);

    toggleDirCollapsed(id, "unstaged", TREE, "src");

    expect(isDirCollapsed(id, "unstaged", TREE, "src")).toBe(false);
    // Siblings stay collapsed.
    expect(isDirCollapsed(id, "unstaged", TREE, "src/components")).toBe(true);
    // Toolbar still says Expand All because some are collapsed.
    expect(hasAnyCollapsed(id, "unstaged", TREE)).toBe(true);
  });
});
