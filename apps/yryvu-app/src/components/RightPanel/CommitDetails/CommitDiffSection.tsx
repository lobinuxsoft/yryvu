// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, For, Show } from "solid-js";

import type { FileDiff } from "../../../ipc/diff";
import { Tooltip } from "../../Tooltip";

/**
 * Stat chip block for the inspector — 1:1 port of GitKraken's
 * `CommitDiffSection` per `docs/research/gitkraken-right-panel/05-stats-and-file-list.md`.
 *
 * GK shows **file counts by status** (added / modified / deleted / renamed),
 * NOT the +N/-N line churn that we previously surfaced. Line counts live on
 * each file row in the list below; the top aggregate is purely file-counted
 * (research doc 05, section "No +N/-N line churn").
 *
 * Status mapping:
 *   - libgit2 `type-change` rolls into `modified` (no dedicated chip in GK).
 *   - libgit2 `copied` rolls into `renamed` (GK groups them under the same
 *     "renamed" label since both come from `find_similar`).
 *   - `unmodified` / `other` are ignored — they should not appear in a diff
 *     payload, but the explicit fallthrough avoids accidental over-counting
 *     if libgit2 ever emits them on edge cases.
 */

type CountKey = "added" | "modified" | "deleted" | "renamed";

const CHIP_LABEL: Record<CountKey, string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
};

const CHIP_ORDER: readonly CountKey[] = [
  "added",
  "modified",
  "deleted",
  "renamed",
];

export function CommitDiffSection(props: {
  files: FileDiff[];
  loading?: boolean;
}) {
  const counts = createMemo<Record<CountKey, number>>(() => {
    const c: Record<CountKey, number> = {
      added: 0,
      modified: 0,
      deleted: 0,
      renamed: 0,
    };
    for (const f of props.files) {
      switch (f.status) {
        case "added":
          c.added += 1;
          break;
        case "modified":
        case "type-change":
          c.modified += 1;
          break;
        case "deleted":
          c.deleted += 1;
          break;
        case "renamed":
        case "copied":
          c.renamed += 1;
          break;
        case "unmodified":
        case "other":
          break;
      }
    }
    return c;
  });

  const totalChanges = createMemo(() => {
    const c = counts();
    return c.added + c.modified + c.deleted + c.renamed;
  });

  return (
    <div
      class="commit-diff__summary"
      classList={{ "is-loading": props.loading }}
      data-testid="commit-detail-panel"
    >
      <Show when={props.loading}>
        <Tooltip text="Computing diff…">
          <span
            class="commit-diff__spinner"
            role="status"
            aria-label="Computing diff"
          />
        </Tooltip>
      </Show>
      <For each={CHIP_ORDER}>
        {(key) => (
          <Show when={counts()[key] > 0}>
            <span
              class={`commit-diff__chip commit-diff__chip--${key}`}
              data-testid={`commit-diff-chip-${key}`}
            >
              <span class="commit-diff__chip-count">{counts()[key]}</span>
              <span class="commit-diff__chip-label">{CHIP_LABEL[key]}</span>
            </span>
          </Show>
        )}
      </For>
      <Show when={!props.loading && totalChanges() === 0}>
        <span class="commit-diff__chip commit-diff__chip--empty">
          No file changes
        </span>
      </Show>
    </div>
  );
}
