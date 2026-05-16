// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createSignal, For, Show } from "solid-js";

import type { MultiSelectOption } from "./index";

interface SelectProps {
  options: MultiSelectOption[];
  /// Currently selected option ID, or `null` for "none".
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /// Allow clearing back to `null`.
  clearable?: boolean;
}

/// Single-select dropdown with search. Companion to [`MultiSelect`]
/// for fields where exactly one (or zero) options apply — milestone,
/// source/target branch.
export function Select(props: SelectProps) {
  const [query, setQuery] = createSignal("");
  const [focused, setFocused] = createSignal(false);

  const selected = createMemo(() => {
    if (!props.value) return null;
    return props.options.find((o) => o.id === props.value) ?? null;
  });

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (q.length === 0) return props.options;
    return props.options.filter((o) => o.displayName.toLowerCase().includes(q));
  });

  function pick(id: string | null) {
    if (props.disabled) return;
    props.onChange(id);
    setQuery("");
  }

  return (
    <div class="multi-select" data-focused={focused() ? "true" : "false"}>
      <div class="multi-select__chips">
        <Show when={selected()}>
          {(s) => (
            <span class="multi-select__chip">
              <span class="multi-select__chip-label">{s().displayName}</span>
              <Show when={props.clearable !== false}>
                <button
                  type="button"
                  class="multi-select__chip-remove"
                  aria-label="Clear"
                  disabled={props.disabled}
                  onClick={() => pick(null)}
                >
                  ×
                </button>
              </Show>
            </span>
          )}
        </Show>
        <input
          class="multi-select__input"
          type="text"
          value={query()}
          placeholder={selected() ? "" : (props.placeholder ?? "Search…")}
          disabled={props.disabled}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
        />
      </div>
      <Show when={focused() && !props.disabled}>
        <div class="multi-select__dropdown">
          <Show
            when={filtered().length > 0}
            fallback={<div class="multi-select__empty">No match</div>}
          >
            <For each={filtered()}>
              {(o) => (
                <button
                  type="button"
                  class="multi-select__option"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o.id);
                  }}
                >
                  <span>{o.displayName}</span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
