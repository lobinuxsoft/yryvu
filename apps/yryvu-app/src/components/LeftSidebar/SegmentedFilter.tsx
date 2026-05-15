// SPDX-License-Identifier: AGPL-3.0-or-later

import { For } from "solid-js";

interface SegmentedFilterProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
  ariaLabel: string;
}

/// Compact segmented control — three-way state filter for the PR /
/// Issue sidebars. Pure presentational; the parent owns the signal.
export function SegmentedFilter<T extends string>(props: SegmentedFilterProps<T>) {
  return (
    <div class="sidebar__segmented" role="tablist" aria-label={props.ariaLabel}>
      <For each={props.options}>
        {(opt) => (
          <button
            type="button"
            class="sidebar__segmented-btn"
            role="tab"
            aria-selected={props.value === opt.value}
            data-active={props.value === opt.value ? "true" : "false"}
            onClick={() => props.onChange(opt.value)}
          >
            {opt.label}
          </button>
        )}
      </For>
    </div>
  );
}
