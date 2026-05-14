// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, createEffect, onCleanup } from "solid-js";

import {
  prFilterDsl,
  prSort,
  setPrFilterDsl,
  setPrSort,
  type PrSortKey,
} from "../../state/pull-requests";

/// Debounce delay for the freeform filter input. Long enough that
/// each keystroke doesn't fire a backend round-trip; short enough
/// that the user perceives the panel responding to their typing.
const DEBOUNCE_MS = 350;

const SORT_OPTIONS: Array<{ value: PrSortKey; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "most_updated", label: "Most updated" },
  { value: "most_commented", label: "Most commented" },
];

/// Filter toolbar above the PR list — freeform query input plus the
/// sort dropdown. Each control is bound to its own state signal so
/// the resource refetches via createResource's source tuple.
///
/// Wave-2 follow-up (deferred for tracker hygiene per
/// `feedback_no_issue_splits`): replace the freeform input with a
/// dropdown cluster (status / author / assignee / reviewer / label /
/// milestone). For now power users compose the GK DSL directly
/// (`author:foo state:open label:bug`).
export function PullRequestToolbar() {
  // Local draft signal so the input renders instantly while the
  // backend round-trip stays debounced.
  const [draft, setDraft] = createSignal(prFilterDsl());
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Resync the draft if `prFilterDsl` changes outside this component
  // (e.g. a "clear filters" button from somewhere else).
  createEffect(() => {
    const next = prFilterDsl();
    if (next !== draft()) setDraft(next);
  });

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const next = e.currentTarget.value;
    setDraft(next);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      setPrFilterDsl(next);
    }, DEBOUNCE_MS);
  };

  return (
    <div class="sidebar__pr-toolbar">
      <input
        class="sidebar__pr-toolbar__filter"
        type="text"
        placeholder='Filter (e.g. author:foo state:open label:"bug")'
        value={draft()}
        onInput={onInput}
        aria-label="Filter pull requests"
      />
      <select
        class="sidebar__pr-toolbar__sort"
        value={prSort()}
        onChange={(e) => setPrSort(e.currentTarget.value as PrSortKey)}
        aria-label="Sort pull requests"
      >
        {SORT_OPTIONS.map((opt) => (
          <option value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
