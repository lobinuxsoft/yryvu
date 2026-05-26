// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import type { DiffHunk } from "../../../ipc";
import { buildInlineMarkedLines } from "../FullFileView";

function hunk(
  newStart: number,
  newCount: number,
  lines: { kind: "added" | "removed" | "context"; text: string }[],
): DiffHunk {
  const result: DiffHunk = {
    old_start: 1,
    old_count: lines.filter((l) => l.kind !== "added").length,
    new_start: newStart,
    new_count: newCount,
    header: `@@ -1,${lines.filter((l) => l.kind !== "added").length} +${newStart},${newCount} @@`,
    lines: [],
  };
  let newNo = newStart;
  let oldNo = 1;
  for (const l of lines) {
    if (l.kind === "added") {
      result.lines.push({ kind: "added", content: l.text, new_line_no: newNo++, old_line_no: null });
    } else if (l.kind === "removed") {
      result.lines.push({ kind: "removed", content: l.text, new_line_no: null, old_line_no: oldNo++ });
    } else {
      result.lines.push({ kind: "context", content: l.text, new_line_no: newNo++, old_line_no: oldNo++ });
    }
  }
  return result;
}

describe("buildInlineMarkedLines", () => {
  it("passes through file lines outside any hunk as context", () => {
    const file = "a\nb\nc\nd\n";
    const lines = buildInlineMarkedLines(file, []);
    expect(lines.map((l) => l.content)).toEqual(["a", "b", "c", "d"]);
    expect(lines.every((l) => l.marker === "context")).toBe(true);
  });

  it("splices hunk lines (+/-/ ) into the modified-side stream at the right offset", () => {
    // Modified file:  a / b-new / c
    // Hunk replaces  "b" with "b-new" at new line 2.
    const file = "a\nb-new\nc\n";
    const h = hunk(2, 1, [
      { kind: "removed", text: "b" },
      { kind: "added", text: "b-new" },
    ]);
    const lines = buildInlineMarkedLines(file, [h]);
    expect(lines.map((l) => ({ k: l.marker, t: l.content }))).toEqual([
      { k: "context", t: "a" },
      { k: "removed", t: "b" },
      { k: "added", t: "b-new" },
      { k: "context", t: "c" },
    ]);
  });

  it("drops the phantom trailing-newline element", () => {
    const file = "only\n";
    const lines = buildInlineMarkedLines(file, []);
    expect(lines).toHaveLength(1);
    expect(lines[0].content).toBe("only");
  });
});
