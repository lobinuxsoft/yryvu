// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, type JSX } from "solid-js";

import { parseBlocks, type Block, type InlineNode } from "../ReleaseNotes/markdown";

/// Render an inline-node array to JSX. Reuses the shared markdown
/// parser to keep the rendering pipeline XSS-safe (no `innerHTML`).
function renderInline(nodes: InlineNode[]): JSX.Element[] {
  return nodes.map((n) => {
    switch (n.kind) {
      case "text":
        return n.value;
      case "strong":
        return <strong>{n.value}</strong>;
      case "em":
        return <em>{n.value}</em>;
      case "code":
        return <code class="pr-detail__inline-code">{n.value}</code>;
      case "link":
        return (
          <a href={n.href} target="_blank" rel="noopener noreferrer">
            {n.text}
          </a>
        );
    }
  });
}

/// Render one block. Native TS `switch` narrows the discriminated
/// union without the `Extract<...>` casts that the Solid
/// `Switch`/`Match` wrapper requires.
function renderBlock(b: Block): JSX.Element {
  switch (b.kind) {
    case "h1":
      return <h1>{renderInline(b.inline)}</h1>;
    case "h2":
      return <h2>{renderInline(b.inline)}</h2>;
    case "h3":
      return <h3>{renderInline(b.inline)}</h3>;
    case "p":
      return <p>{renderInline(b.inline)}</p>;
    case "ul":
      return (
        <ul>
          <For each={b.items}>{(item) => <li>{renderInline(item)}</li>}</For>
        </ul>
      );
    case "pre":
      return (
        <pre>
          <code>{b.code}</code>
        </pre>
      );
    case "hr":
      return <hr />;
  }
}

interface MarkdownProps {
  source: string;
}

/// Render a markdown string to a block tree without `innerHTML`. The
/// parser ignores anything outside its supported subset (CommonMark
/// minus images / tables / blockquotes); unrenderable fragments
/// collapse to plain paragraphs, which is fine for PR bodies.
export function Markdown(props: MarkdownProps): JSX.Element {
  const blocks = (): Block[] => parseBlocks(props.source);
  return (
    <div class="pr-detail__markdown">
      <For each={blocks()}>{renderBlock}</For>
    </div>
  );
}
