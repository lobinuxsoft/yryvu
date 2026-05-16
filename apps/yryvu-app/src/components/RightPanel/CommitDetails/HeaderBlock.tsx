// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, Show } from "solid-js";

import { Tooltip } from "../../Tooltip";

/**
 * First block of the commit inspector: 6-char SHA + copy button + parent
 * list. 1:1 port of GitKraken's `commit-header` block per
 * `docs/research/gitkraken-right-panel/02-commit-header.md`.
 *
 * Copy-SHA tooltip behavior (bundle verified): "Copy" by default, swaps
 * to "Copied!" on click, and resets on `blur` — not on a timer. Matching
 * the detail matters; the wrong timing is the kind of thing that makes
 * the port feel almost-right.
 *
 * Parents render as small clickable pills. Clicking one selects that
 * commit in the graph (delegated via `onSelectParent`).
 */
export function HeaderBlock(props: {
  sha: string;
  shortSha: string;
  parentShas: string[];
  onSelectParent: (sha: string) => void;
}) {
  const [copied, setCopied] = createSignal(false);

  async function copySha() {
    try {
      await navigator.clipboard.writeText(props.sha);
      setCopied(true);
    } catch (err) {
      console.error("clipboard write failed", err);
    }
  }

  return (
    <div class="commit-detail__header">
      <div class="commit-detail__header-row">
        <span class="commit-detail__header-label">commit</span>
        <Tooltip text={copied() ? "Copied!" : "Copy"}>
          <button
            type="button"
            class="commit-detail__sha"
            classList={{ "is-copied": copied() }}
            onClick={copySha}
            onBlur={() => setCopied(false)}
          >
            <code>{props.shortSha}</code>
          </button>
        </Tooltip>
      </div>
      <Show when={props.parentShas.length > 0}>
        <div class="commit-detail__header-row">
          <span class="commit-detail__header-label">
            {props.parentShas.length === 1 ? "parent" : "parents"}
          </span>
          <span class="commit-detail__parents">
            <For each={props.parentShas}>
              {(parentSha, idx) => (
                <>
                  <Show when={idx() > 0}>
                    <span class="commit-detail__parents-sep">,</span>
                  </Show>
                  <Tooltip text="Jump to commit in graph">
                    <button
                      type="button"
                      class="commit-detail__parent"
                      onClick={() => props.onSelectParent(parentSha)}
                    >
                      <code>{parentSha.slice(0, 6)}</code>
                    </button>
                  </Tooltip>
                </>
              )}
            </For>
          </span>
        </div>
      </Show>
    </div>
  );
}
