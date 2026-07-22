// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import type { FileDiffMeta } from "../../../ipc/diff";
import { buildTreeFromPaths, flattenFlat, type TreeNode } from "../treeBuild";

const file = (path: string): FileDiffMeta =>
  ({ path, old_path: null, status: "modified" }) as unknown as FileDiffMeta;

const FILES = [
  file("src/state/index.ts"),
  file("src/components/Row.tsx"),
  file("README.md"),
  file("docs/PLAN.md"),
];

const visible = () => true;

/// Flattens the tree to `path` strings in render order, dirs included, so
/// a direction flip is visible at every depth rather than only at the leaves.
function order(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      out.push(node.path);
      if (node.kind === "dir") walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

describe("FileList sort direction (issue #151 item B)", () => {
  it("defaults to ascending, dirs before files at each level", () => {
    expect(order(buildTreeFromPaths(FILES))).toEqual([
      "docs",
      "docs/PLAN.md",
      "src",
      "src/components",
      "src/components/Row.tsx",
      "src/state",
      "src/state/index.ts",
      "README.md",
    ]);
  });

  it("descending reverses directory order AND file order at every depth", () => {
    expect(order(buildTreeFromPaths(FILES, true))).toEqual([
      "src",
      "src/state",
      "src/state/index.ts",
      "src/components",
      "src/components/Row.tsx",
      "docs",
      "docs/PLAN.md",
      "README.md",
    ]);
  });

  it("keeps dirs grouped ahead of files in both directions", () => {
    // Descending must not promote the root-level file above the dirs —
    // GK reverses within each group, it does not reverse the grouping.
    const rows = order(buildTreeFromPaths(FILES, true));
    expect(rows[rows.length - 1]).toBe("README.md");
  });

  it("flat mode sorts by full path in both directions", () => {
    const asc = flattenFlat(FILES, visible).map((r) => r.path);
    const desc = flattenFlat(FILES, visible, true).map((r) => r.path);
    // `localeCompare` is case-insensitive at the primary level, so
    // "docs/" sorts before "README.md" — the pre-existing flat-mode
    // ordering, unchanged by this feature.
    expect(asc).toEqual([
      "docs/PLAN.md",
      "README.md",
      "src/components/Row.tsx",
      "src/state/index.ts",
    ]);
    expect(desc).toEqual([...asc].reverse());
  });

  it("descending still honours the visibility filter", () => {
    const rows = flattenFlat(FILES, (p) => p.startsWith("src/"), true).map(
      (r) => r.path,
    );
    expect(rows).toEqual(["src/state/index.ts", "src/components/Row.tsx"]);
  });
});
