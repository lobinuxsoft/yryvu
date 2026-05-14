// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Switch, Match, type JSX } from "solid-js";

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
        // External targets only — the parser doesn't emit relative
        // hrefs from GitHub PR bodies in practice.
        return (
          <a href={n.href} target="_blank" rel="noopener noreferrer">
            {n.text}
          </a>
        );
    }
  });
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
      <For each={blocks()}>
        {(b) => (
          <Switch>
            <Match when={b.kind === "h1"}>
              <h1>{renderInline((b as Extract<Block, { kind: "h1" }>).inline)}</h1>
            </Match>
            <Match when={b.kind === "h2"}>
              <h2>{renderInline((b as Extract<Block, { kind: "h2" }>).inline)}</h2>
            </Match>
            <Match when={b.kind === "h3"}>
              <h3>{renderInline((b as Extract<Block, { kind: "h3" }>).inline)}</h3>
            </Match>
            <Match when={b.kind === "p"}>
              <p>{renderInline((b as Extract<Block, { kind: "p" }>).inline)}</p>
            </Match>
            <Match when={b.kind === "ul"}>
              <ul>
                <For each={(b as Extract<Block, { kind: "ul" }>).items}>
                  {(item) => <li>{renderInline(item)}</li>}
                </For>
              </ul>
            </Match>
            <Match when={b.kind === "pre"}>
              <pre>
                <code>{(b as Extract<Block, { kind: "pre" }>).code}</code>
              </pre>
            </Match>
            <Match when={b.kind === "hr"}>
              <hr />
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}
