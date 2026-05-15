// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, createEffect, onCleanup } from "solid-js";

import {
  issueStateFilter,
  issueTextFilter,
  setIssueStateFilter,
  setIssueTextFilter,
  type IssueStateFilter,
} from "../../state/issues";
import { SegmentedFilter } from "./SegmentedFilter";

const DEBOUNCE_MS = 200;

const STATE_OPTIONS: ReadonlyArray<{ value: IssueStateFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

/// Filter toolbar above the Issues list — segmented state + text
/// quick-filter (substring on title, client-side). Mirrors the PR
/// toolbar pattern for consistency.
export function IssuesToolbar() {
  const [draft, setDraft] = createSignal(issueTextFilter());
  let timer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    const next = issueTextFilter();
    if (next !== draft()) setDraft(next);
  });

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const next = e.currentTarget.value;
    setDraft(next);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setIssueTextFilter(next), DEBOUNCE_MS);
  };

  return (
    <div class="sidebar__pr-toolbar">
      <SegmentedFilter
        value={issueStateFilter()}
        options={STATE_OPTIONS}
        onChange={setIssueStateFilter}
        ariaLabel="Filter issues by state"
      />
      <div class="sidebar__pr-toolbar__row">
        <input
          class="sidebar__pr-toolbar__filter"
          type="text"
          placeholder="Filter by title…"
          value={draft()}
          onInput={onInput}
          aria-label="Filter issues by title"
        />
      </div>
    </div>
  );
}
