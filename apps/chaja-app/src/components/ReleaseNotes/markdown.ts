// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Minimal markdown → block tree parser. Targets the subset of CommonMark
 * that release-please emits in CHANGELOG.md: headings, bullet lists,
 * paragraphs, fenced code blocks, horizontal rules, plus inline bold /
 * italic / inline-code / links.
 *
 * Why a DIY parser instead of `marked` or `markdown-it`:
 *   - Zero npm deps (supply-chain hygiene).
 *   - The block surface is small and stable.
 *   - The output is a pure block tree, not HTML — Solid renders it
 *     without `innerHTML`, sidestepping XSS.
 *
 * Anchor IDs on h2 / h3 use a slug from the heading text so the
 * version-jump scroll works (the ReleaseNotesBody component receives
 * the active version as a prop and scrolls into view).
 */

export type InlineNode =
  | { kind: "text"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "em"; value: string }
  | { kind: "code"; value: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "h1"; id: string; inline: InlineNode[] }
  | { kind: "h2"; id: string; inline: InlineNode[] }
  | { kind: "h3"; id: string; inline: InlineNode[] }
  | { kind: "p"; inline: InlineNode[] }
  | { kind: "ul"; items: InlineNode[][] }
  | { kind: "pre"; lang: string; code: string }
  | { kind: "hr" };

/// Convert a heading's plain text to an anchor id slug. Periods and
/// whitespace runs collapse to a single dash, so version numbers like
/// "0.4.2" don't lose their separators (the naive `[^a-z0-9-]` strip
/// would output "042"). Brackets, parens, and other punctuation become
/// gaps before the collapse, matching GitHub's anchor convention.
///
/// "## [0.4.2] (2026-04-30)" → "0-4-2-2026-04-30"
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s._-]/g, " ")
    .replace(/[\s._]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/// Block-level parser. Splits by blank lines, classifies each chunk by
/// its leading marker, and emits a block. Lists are grouped greedily
/// across consecutive bullet lines.
export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code block — capture until the closing fence.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // consume the closing fence
      blocks.push({ kind: "pre", lang, code: codeLines.join("\n") });
      continue;
    }

    // Horizontal rule.
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const inline = parseInline(text);
      const id = slugify(stripInline(inline));
      const kind = (`h${level}` as "h1" | "h2" | "h3");
      blocks.push({ kind, id, inline });
      i += 1;
      continue;
    }

    // Bullet list — collect consecutive `* ` / `- ` lines.
    if (/^[*-]\s+/.test(line)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && /^[*-]\s+/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^[*-]\s+/, "")));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Paragraph — fold consecutive non-blank lines into one block.
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3}\s|[*-]\s|---|```)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "p", inline: parseInline(para.join(" ")) });
  }

  return blocks;
}

/// Inline-level parser. Greedy left-to-right scan, recognizing the
/// 4 inline markers in priority order: code (backtick) > strong (**) >
/// em (*) > link ([text](url)). Anything else is plain text.
///
/// The order matters because backtick-fenced spans should NOT have
/// inner ** parsed (markdown semantics).
export function parseInline(input: string): InlineNode[] {
  const out: InlineNode[] = [];
  let i = 0;
  let buffer = "";

  const flush = () => {
    if (buffer.length > 0) {
      out.push({ kind: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < input.length) {
    const ch = input[i];

    // Inline code.
    if (ch === "`") {
      const end = input.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ kind: "code", value: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Bold (**foo**).
    if (ch === "*" && input[i + 1] === "*") {
      const end = input.indexOf("**", i + 2);
      if (end > i + 1) {
        flush();
        out.push({ kind: "strong", value: input.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    // Italic (*foo*) — only when not followed by another asterisk
    // (the bold case above ate that path).
    if (ch === "*" && input[i + 1] !== "*") {
      const end = input.indexOf("*", i + 1);
      if (end > i) {
        flush();
        out.push({ kind: "em", value: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Link ([text](href)).
    if (ch === "[") {
      const closeBracket = input.indexOf("]", i + 1);
      if (closeBracket > i && input[closeBracket + 1] === "(") {
        const closeParen = input.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket) {
          flush();
          out.push({
            kind: "link",
            text: input.slice(i + 1, closeBracket),
            href: input.slice(closeBracket + 2, closeParen),
          });
          i = closeParen + 1;
          continue;
        }
      }
    }

    buffer += ch;
    i += 1;
  }
  flush();

  return out;
}

/// Concatenate inline nodes into plain text — used only for slug
/// generation (anchor ids).
function stripInline(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
          return n.value;
        case "strong":
        case "em":
        case "code":
          return n.value;
        case "link":
          return n.text;
      }
    })
    .join("");
}
