// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, createEffect, For, onCleanup } from "solid-js";

import {
  prSort,
  prStateFilter,
  prTextFilter,
  setPrSort,
  setPrStateFilter,
  setPrTextFilter,
  type PrSortKey,
  type PrStateFilter,
} from "../../state/pull-requests";
import { SegmentedFilter } from "./SegmentedFilter";

/// Debounce delay for the text quick-filter. Long enough to feel
/// reactive without re-running the client-side filter on every key.
const DEBOUNCE_MS = 200;

const SORT_OPTIONS: ReadonlyArray<{ value: PrSortKey; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "most_updated", label: "Most updated" },
  { value: "most_commented", label: "Most commented" },
];

const STATE_OPTIONS: ReadonlyArray<{ value: PrStateFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

/// Filter toolbar above the PR list. Visual filters only — segmented
/// state + text quick-filter (substring on title, client-side) + sort
/// dropdown. The state filter and text filter compose with each
/// other; the resource keeps the full list and the row renderer
/// trims it down.
export function PullRequestToolbar() {
  const [draft, setDraft] = createSignal(prTextFilter());
  let timer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    const next = prTextFilter();
    if (next !== draft()) setDraft(next);
  });

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const next = e.currentTarget.value;
    setDraft(next);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setPrTextFilter(next), DEBOUNCE_MS);
  };

  return (
    <div class="sidebar__pr-toolbar">
      <SegmentedFilter
        value={prStateFilter()}
        options={STATE_OPTIONS}
        onChange={setPrStateFilter}
        ariaLabel="Filter pull requests by state"
      />
      <div class="sidebar__pr-toolbar__row">
        <input
          class="sidebar__pr-toolbar__filter"
          type="text"
          placeholder="Filter by title…"
          value={draft()}
          onInput={onInput}
          aria-label="Filter pull requests by title"
        />
        <select
          class="sidebar__pr-toolbar__sort"
          value={prSort()}
          onChange={(e) => setPrSort(e.currentTarget.value as PrSortKey)}
          aria-label="Sort pull requests"
        >
          <For each={SORT_OPTIONS}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>
      </div>
    </div>
  );
}
