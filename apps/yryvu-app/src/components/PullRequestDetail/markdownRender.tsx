// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show, type JSX } from "solid-js";

import {
  parseBlocks,
  type Block,
  type InlineNode,
  type ListItem,
} from "../ReleaseNotes/markdown";

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

/// Render a single list item. Normal bullets get a plain `<li>`;
/// GFM task items get a disabled checkbox prefix matching GitHub /
/// GK's rendering (read-only — yryvu doesn't post toggle edits back).
function renderListItem(item: ListItem): JSX.Element {
  return (
    <li
      class={item.checked === null ? undefined : "pr-detail__task-item"}
      data-checked={item.checked === true ? "true" : undefined}
    >
      <Show when={item.checked !== null}>
        <input
          type="checkbox"
          class="pr-detail__task-checkbox"
          checked={item.checked === true}
          disabled
          aria-readonly="true"
          tabindex={-1}
        />
      </Show>
      {renderInline(item.inline)}
    </li>
  );
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
          <For each={b.items}>{renderListItem}</For>
        </ul>
      );
    case "ol":
      return (
        <ol>
          <For each={b.items}>{renderListItem}</For>
        </ol>
      );
    case "bq":
      return (
        <blockquote class="pr-detail__blockquote">
          <For each={b.blocks}>{renderBlock}</For>
        </blockquote>
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
/// parser covers headings, paragraphs, bullet + ordered lists,
/// blockquotes, fenced code, horizontal rules, plus inline bold /
/// italic / code / links. Unsupported fragments collapse to plain
/// paragraphs, which is fine for PR bodies.
export function Markdown(props: MarkdownProps): JSX.Element {
  const blocks = (): Block[] => parseBlocks(props.source);
  return (
    <div class="pr-detail__markdown">
      <For each={blocks()}>{renderBlock}</For>
    </div>
  );
}
