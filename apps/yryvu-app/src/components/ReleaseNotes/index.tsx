// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ReleaseNotesBody — main viewport content for `currentTabType() ===
 * "RELEASE_NOTES"`. Loads the bundled CHANGELOG.md via the bridge,
 * parses it through the DIY markdown helper, and renders the block
 * tree as Solid JSX.
 *
 * Anchor jump: each h2/h3 heading gets an id from `slugify(text)`.
 * On mount (and when `version` changes), scroll the matching section
 * into view. release-please writes "## [0.4.2] (2026-04-30)" — slug
 * is "0-4-2-2026-04-30", so we look up the heading whose slug starts
 * with the active version's slug.
 *
 * Empty states:
 *   - present === false → "No release notes yet" + GitHub fallback link
 *   - present === true && markdown.trim() === "" → "Changelog is empty"
 */

import { createMemo, createResource, For, Show } from "solid-js";

import { readChangelog } from "../../ipc";
import { type Block, parseBlocks, slugify } from "./markdown";

interface Props {
  /// Version captured at tab create time. Used as the scroll target.
  /// Empty string → no auto-scroll (e.g. menu-opened tab without version).
  version: string;
}

export function ReleaseNotesBody(props: Props) {
  const [contents] = createResource(() => readChangelog());

  const blocks = createMemo<Block[]>(() => {
    const c = contents();
    if (!c || !c.present) return [];
    return parseBlocks(c.markdown);
  });

  const versionSlug = () => slugify(props.version);

  // Defer scrollIntoView until the DOM has the headings rendered.
  // queueMicrotask after the Show branch flips ensures the elements
  // exist; if no matching heading is found it's a no-op.
  const scrollToVersion = (el: HTMLElement | undefined) => {
    if (!el) return;
    const slug = versionSlug();
    if (!slug) return;
    queueMicrotask(() => {
      const target =
        el.querySelector(`[id="${slug}"]`) ||
        // Fall back to "starts with the version slug" — release-please
        // headings include the date, so the exact slug is longer than
        // just the version.
        Array.from(el.querySelectorAll("[id]")).find((n) =>
          (n as HTMLElement).id.startsWith(slug),
        );
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ behavior: "auto", block: "start" });
      }
    });
  };

  return (
    <section class="release-notes" ref={scrollToVersion}>
      <Show
        when={contents()?.present}
        fallback={
          <div class="release-notes__empty">
            <h2>No release notes yet</h2>
            <p>
              chajá hasn't shipped its first release. Once the first{" "}
              <code>feat:</code> or <code>fix:</code> commit lands on{" "}
              <code>main</code>, release-please will generate a{" "}
              <code>CHANGELOG.md</code> and this tab will render it.
            </p>
          </div>
        }
      >
        <Show
          when={contents()!.markdown.trim().length > 0}
          fallback={
            <div class="release-notes__empty">
              <h2>Changelog is empty</h2>
            </div>
          }
        >
          <div class="release-notes__doc">
            <For each={blocks()}>{(b) => <BlockView block={b} />}</For>
          </div>
        </Show>
      </Show>
    </section>
  );
}

function BlockView(props: { block: Block }) {
  const b = props.block;
  switch (b.kind) {
    case "h1":
      return (
        <h1 id={b.id}>
          <InlineList nodes={b.inline} />
        </h1>
      );
    case "h2":
      return (
        <h2 id={b.id}>
          <InlineList nodes={b.inline} />
        </h2>
      );
    case "h3":
      return (
        <h3 id={b.id}>
          <InlineList nodes={b.inline} />
        </h3>
      );
    case "p":
      return (
        <p>
          <InlineList nodes={b.inline} />
        </p>
      );
    case "ul":
      return (
        <ul>
          <For each={b.items}>
            {(item) => (
              <li>
                <Show when={item.checked !== null}>
                  <input
                    type="checkbox"
                    checked={item.checked === true}
                    disabled
                    aria-readonly="true"
                    tabindex={-1}
                  />{" "}
                </Show>
                <InlineList nodes={item.inline} />
              </li>
            )}
          </For>
        </ul>
      );
    case "ol":
      return (
        <ol>
          <For each={b.items}>
            {(item) => (
              <li>
                <InlineList nodes={item.inline} />
              </li>
            )}
          </For>
        </ol>
      );
    case "bq":
      return (
        <blockquote>
          <For each={b.blocks}>{(inner) => <BlockView block={inner} />}</For>
        </blockquote>
      );
    case "pre":
      return (
        <pre data-lang={b.lang || undefined}>
          <code>{b.code}</code>
        </pre>
      );
    case "hr":
      return <hr />;
  }
}

function InlineList(props: { nodes: Block extends infer _ ? unknown : never }) {
  // The TS narrowing inside For makes this type tricky; use any-cast
  // via the actual inline shape.
  const nodes = (props as unknown as { nodes: import("./markdown").InlineNode[] })
    .nodes;
  return (
    <For each={nodes}>
      {(n) => {
        switch (n.kind) {
          case "text":
            return <>{n.value}</>;
          case "strong":
            return <strong>{n.value}</strong>;
          case "em":
            return <em>{n.value}</em>;
          case "code":
            return <code>{n.value}</code>;
          case "link":
            return (
              <a href={n.href} target="_blank" rel="noopener noreferrer">
                {n.text}
              </a>
            );
        }
      }}
    </For>
  );
}
