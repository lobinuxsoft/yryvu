// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { linkifyIssueRefs } from "../linkify-issues";

const PATTERN = "https://example.com/issues/{id}";

describe("linkifyIssueRefs", () => {
  it("passes through when disabled", () => {
    expect(linkifyIssueRefs("fix #123 typo", PATTERN, false)).toEqual([
      { kind: "text", value: "fix #123 typo" },
    ]);
  });

  it("passes through when pattern is null", () => {
    expect(linkifyIssueRefs("fix #123 typo", null, true)).toEqual([
      { kind: "text", value: "fix #123 typo" },
    ]);
  });

  it("passes through when pattern is empty string", () => {
    expect(linkifyIssueRefs("fix #123 typo", "", true)).toEqual([
      { kind: "text", value: "fix #123 typo" },
    ]);
  });

  it("passes through when no refs present", () => {
    expect(linkifyIssueRefs("plain commit message", PATTERN, true)).toEqual([
      { kind: "text", value: "plain commit message" },
    ]);
  });

  it("rewrites a single ref into a link segment", () => {
    expect(linkifyIssueRefs("fix #123 typo", PATTERN, true)).toEqual([
      { kind: "text", value: "fix " },
      {
        kind: "link",
        text: "#123",
        href: "https://example.com/issues/123",
      },
      { kind: "text", value: " typo" },
    ]);
  });

  it("rewrites multiple refs in one string", () => {
    const segments = linkifyIssueRefs("close #1 + #42 in #999", PATTERN, true);
    const links = segments.filter((s) => s.kind === "link");
    expect(links).toEqual([
      { kind: "link", text: "#1", href: "https://example.com/issues/1" },
      { kind: "link", text: "#42", href: "https://example.com/issues/42" },
      {
        kind: "link",
        text: "#999",
        href: "https://example.com/issues/999",
      },
    ]);
  });

  it("ignores hash without digits", () => {
    expect(linkifyIssueRefs("fix #typo and #", PATTERN, true)).toEqual([
      { kind: "text", value: "fix #typo and #" },
    ]);
  });

  it("ignores fragment-like #abc123 (must start with digit)", () => {
    expect(linkifyIssueRefs("see #abc123", PATTERN, true)).toEqual([
      { kind: "text", value: "see #abc123" },
    ]);
  });

  it("does not match URL fragments preceded by a path slash", () => {
    // The regex's negative lookbehind requires the char before `#` not
    // to be `\w` OR `/`. Pin that contract — false positives on URL
    // fragments would be confusing.
    expect(linkifyIssueRefs("see /foo#123 done", PATTERN, true)).toEqual([
      { kind: "text", value: "see /foo#123 done" },
    ]);
  });

  it("appends id when pattern lacks {id} placeholder", () => {
    const segments = linkifyIssueRefs(
      "fix #7",
      "https://legacy.example.com/i/",
      true,
    );
    expect(segments[1]).toEqual({
      kind: "link",
      text: "#7",
      href: "https://legacy.example.com/i/7",
    });
  });

  it("interpolates all {id} occurrences in pattern", () => {
    const segments = linkifyIssueRefs("see #99", "https://a/{id}/b/{id}", true);
    expect(segments[1]).toEqual({
      kind: "link",
      text: "#99",
      href: "https://a/99/b/99",
    });
  });

  it("returns single text segment for empty input", () => {
    expect(linkifyIssueRefs("", PATTERN, true)).toEqual([
      { kind: "text", value: "" },
    ]);
  });

  it("does not absorb trailing punctuation into the ref", () => {
    const segments = linkifyIssueRefs("close #5, then ship", PATTERN, true);
    expect(segments).toEqual([
      { kind: "text", value: "close " },
      {
        kind: "link",
        text: "#5",
        href: "https://example.com/issues/5",
      },
      { kind: "text", value: ", then ship" },
    ]);
  });
});
