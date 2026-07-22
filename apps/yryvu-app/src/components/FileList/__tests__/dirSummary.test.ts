// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import type { FileDiffMeta, FileStatus } from "../../../ipc/diff";
import {
  buildTreeFromPaths,
  flattenTree,
  summaryIsEmpty,
  SUMMARY_ORDER,
  type DirNode,
  type TreeNode,
} from "../treeBuild";

const file = (path: string, status: FileStatus = "modified"): FileDiffMeta =>
  ({ path, old_path: null, status }) as unknown as FileDiffMeta;

function dirAt(nodes: TreeNode[], path: string): DirNode {
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind !== "dir") continue;
    if (node.path === path) return node;
    stack.push(...node.children);
  }
  throw new Error(`no dir ${path}`);
}

describe("collapsed-directory status summary (issue #437)", () => {
  it("counts a leaf directory's own files per status", () => {
    const tree = buildTreeFromPaths([
      file("src/a.ts", "added"),
      file("src/b.ts", "modified"),
      file("src/c.ts", "modified"),
      file("src/d.ts", "deleted"),
    ]);

    expect(dirAt(tree, "src").summary).toEqual({
      added: 1,
      modified: 2,
      deleted: 1,
      renamed: 0,
    });
  });

  it("rolls descendants up through every ancestor", () => {
    const tree = buildTreeFromPaths([
      file("a/b/c/deep.ts", "added"),
      file("a/b/mid.ts", "deleted"),
      file("a/top.ts", "modified"),
    ]);

    expect(dirAt(tree, "a/b/c").summary.added).toBe(1);
    expect(dirAt(tree, "a/b").summary).toEqual({
      added: 1,
      modified: 0,
      deleted: 1,
      renamed: 0,
    });
    // The root-most folder answers for the whole subtree, which is the
    // point: collapsed, it's the only thing on screen.
    expect(dirAt(tree, "a").summary).toEqual({
      added: 1,
      modified: 1,
      deleted: 1,
      renamed: 0,
    });
  });

  it("folds the statuses that share a bucket with the file rows", () => {
    // `copied` reads as a rename and `type-change` as a modification —
    // the same collapse `statusTone` applies to the per-file chips, so a
    // folder can't disagree with the rows inside it.
    const tree = buildTreeFromPaths([
      file("x/renamed.ts", "renamed"),
      file("x/copied.ts", "copied"),
      file("x/typed.ts", "type-change"),
    ]);

    expect(dirAt(tree, "x").summary).toEqual({
      added: 0,
      modified: 1,
      deleted: 0,
      renamed: 2,
    });
  });

  it("a directory holding no files at all summarises to nothing", () => {
    const tree = buildTreeFromPaths([file("only/deep/f.ts", "added")]);
    expect(summaryIsEmpty(dirAt(tree, "only").summary)).toBe(false);
    expect(summaryIsEmpty({ added: 0, modified: 0, deleted: 0, renamed: 0 })).toBe(
      true,
    );
  });

  it("the summary survives onto the flattened rows", () => {
    const tree = buildTreeFromPaths([file("src/a.ts", "added")]);
    const rows = flattenTree(
      tree,
      () => false,
      () => true,
    );
    const dirRow = rows.find((r) => r.kind === "dir");
    expect(dirRow).toBeDefined();
    expect(dirRow!.kind === "dir" && dirRow!.summary.added).toBe(1);
  });

  it("is not filter-aware — a folder still owns what it contains", () => {
    // A count that shrank while typing would read as changes vanishing.
    // The filter hides rows; it doesn't change what the folder holds.
    const tree = buildTreeFromPaths([
      file("src/keep.ts", "added"),
      file("src/hidden.ts", "deleted"),
    ]);
    const rows = flattenTree(
      tree,
      () => false,
      (path) => path.includes("keep"),
    );
    const dirRow = rows.find((r) => r.kind === "dir")!;
    expect(dirRow.kind === "dir" && dirRow.summary).toEqual({
      added: 1,
      modified: 0,
      deleted: 1,
      renamed: 0,
    });
  });

  it("sort direction does not disturb the counts", () => {
    const files = [file("s/a.ts", "added"), file("s/b.ts", "deleted")];
    expect(dirAt(buildTreeFromPaths(files, true), "s").summary).toEqual(
      dirAt(buildTreeFromPaths(files, false), "s").summary,
    );
  });

  it("badge order matches GitKraken's emission order", () => {
    expect(SUMMARY_ORDER).toEqual([
      "modified",
      "added",
      "deleted",
      "renamed",
    ]);
  });
});
