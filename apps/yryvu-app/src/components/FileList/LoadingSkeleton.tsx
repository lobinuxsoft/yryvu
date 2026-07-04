// SPDX-License-Identifier: AGPL-3.0-or-later

import { For } from "solid-js";

import { ROW_HEIGHT } from "./Row";

/**
 * Placeholder rows shown while the diff resource is in flight. Bridges
 * the gap between selection-changed and combined-diff-resolved so the
 * file list never collapses to a blank panel while libgit2 is computing
 * (the eggscape regression — 15K dirty files produced a several-second
 * blank state). Geometry mirrors `Row.tsx` (height + indent) so the
 * column doesn't reflow when real rows replace the skeletons.
 *
 * Each placeholder uses pseudo-randomised widths so the row band reads
 * as content rather than a regular pattern. Widths are derived from the
 * row index, not random — keeping renders deterministic across HMR
 * reloads matters for visual diffing of screenshots in PRs.
 */
const ROW_COUNT = 8;
const DEPTH_PATTERN: readonly number[] = [0, 1, 1, 2, 1, 0, 1, 2];
const WIDTH_PATTERN: readonly string[] = [
  "62%",
  "48%",
  "55%",
  "40%",
  "70%",
  "52%",
  "45%",
  "58%",
];

export function LoadingSkeleton() {
  const rows = Array.from({ length: ROW_COUNT }, (_, i) => i);

  return (
    <div class="file-list__items file-list__items--skeleton" aria-busy="true">
      <For each={rows}>
        {(i) => (
          <div class="file-list__item">
            <div
              class="file-list__row file-list__row--skeleton"
              style={{
                "padding-left": `${DEPTH_PATTERN[i] * 15 + 10}px`,
                height: `${ROW_HEIGHT}px`,
              }}
              aria-hidden="true"
            >
              <span class="file-list__skeleton-icon" />
              <span
                class="file-list__skeleton-bar"
                style={{ width: WIDTH_PATTERN[i] }}
              />
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
