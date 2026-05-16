// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { parseBlocks, parseInline, slugify } from "../markdown";

describe("slugify", () => {
  it("converts heading text to a kebab-case anchor id", () => {
    expect(slugify("Release Notes")).toBe("release-notes");
    expect(slugify("[0.4.2] (2026-04-30)")).toBe("0-4-2-2026-04-30");
    expect(slugify("Bug Fixes")).toBe("bug-fixes");
  });

  it("collapses repeated whitespace", () => {
    expect(slugify("Hello   World")).toBe("hello-world");
  });

  it("returns empty string for symbol-only input", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("parseInline", () => {
  it("plain text → single text node", () => {
    expect(parseInline("hello")).toEqual([{ kind: "text", value: "hello" }]);
  });

  it("**bold** → strong node", () => {
    const out = parseInline("a **b** c");
    expect(out).toEqual([
      { kind: "text", value: "a " },
      { kind: "strong", value: "b" },
      { kind: "text", value: " c" },
    ]);
  });

  it("*italic* → em node", () => {
    const out = parseInline("a *b* c");
    expect(out).toEqual([
      { kind: "text", value: "a " },
      { kind: "em", value: "b" },
      { kind: "text", value: " c" },
    ]);
  });

  it("`code` → code node", () => {
    const out = parseInline("use `feat:` prefix");
    expect(out).toEqual([
      { kind: "text", value: "use " },
      { kind: "code", value: "feat:" },
      { kind: "text", value: " prefix" },
    ]);
  });

  it("[text](url) → link node", () => {
    const out = parseInline("see [issue](https://x.com/a)");
    expect(out).toEqual([
      { kind: "text", value: "see " },
      { kind: "link", text: "issue", href: "https://x.com/a" },
    ]);
  });

  it("backtick spans don't parse inner ** markers", () => {
    const out = parseInline("`**not bold**`");
    expect(out).toEqual([{ kind: "code", value: "**not bold**" }]);
  });

  it("unclosed marker falls back to text", () => {
    expect(parseInline("a **unclosed")).toEqual([
      { kind: "text", value: "a **unclosed" },
    ]);
  });
});

describe("parseBlocks", () => {
  it("parses a heading", () => {
    const out = parseBlocks("## Bug Fixes");
    expect(out).toEqual([
      {
        kind: "h2",
        id: "bug-fixes",
        inline: [{ kind: "text", value: "Bug Fixes" }],
      },
    ]);
  });

  it("parses a bullet list", () => {
    const out = parseBlocks("* item one\n* item two");
    expect(out).toEqual([
      {
        kind: "ul",
        items: [
          { checked: null, inline: [{ kind: "text", value: "item one" }] },
          { checked: null, inline: [{ kind: "text", value: "item two" }] },
        ],
      },
    ]);
  });

  it("parses GFM task list items into ListItem.checked", () => {
    const out = parseBlocks("- [ ] todo\n- [x] done\n- plain");
    expect(out[0]).toEqual({
      kind: "ul",
      items: [
        { checked: false, inline: [{ kind: "text", value: "todo" }] },
        { checked: true, inline: [{ kind: "text", value: "done" }] },
        { checked: null, inline: [{ kind: "text", value: "plain" }] },
      ],
    });
  });

  it("treats - the same as * for list items", () => {
    const out = parseBlocks("- a\n- b");
    expect(out[0].kind).toBe("ul");
  });

  it("folds consecutive non-marker lines into one paragraph", () => {
    const out = parseBlocks("hello\nworld");
    expect(out).toEqual([
      {
        kind: "p",
        inline: [{ kind: "text", value: "hello world" }],
      },
    ]);
  });

  it("blank line breaks a paragraph", () => {
    const out = parseBlocks("first\n\nsecond");
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("p");
    expect(out[1].kind).toBe("p");
  });

  it("parses fenced code block with lang", () => {
    const md = "```rust\nfn main() {}\n```";
    const out = parseBlocks(md);
    expect(out).toEqual([
      { kind: "pre", lang: "rust", code: "fn main() {}" },
    ]);
  });

  it("parses horizontal rule", () => {
    expect(parseBlocks("---")).toEqual([{ kind: "hr" }]);
    expect(parseBlocks("***")).toEqual([{ kind: "hr" }]);
  });

  it("end-to-end CHANGELOG fragment", () => {
    const md = [
      "# Changelog",
      "",
      "## [0.4.2] (2026-04-30)",
      "",
      "### Features",
      "",
      "* added Cmd+T keybind",
      "* port [release notes](https://github.com/x) tab",
      "",
      "### Bug Fixes",
      "",
      "* fixed `Cmd+W` not firing",
    ].join("\n");
    const out = parseBlocks(md);
    expect(out.map((b) => b.kind)).toEqual([
      "h1",
      "h2",
      "h3",
      "ul",
      "h3",
      "ul",
    ]);
    // Anchor ids work for the version heading
    expect((out[1] as { id: string }).id).toBe("0-4-2-2026-04-30");
    // Inline link inside a list item parses
    const ul = out[3] as { kind: "ul"; items: { inline: unknown[] }[] };
    const link = ul.items[1].inline.find(
      (n) => (n as { kind: string }).kind === "link",
    );
    expect(link).toEqual({
      kind: "link",
      text: "release notes",
      href: "https://github.com/x",
    });
  });
});
