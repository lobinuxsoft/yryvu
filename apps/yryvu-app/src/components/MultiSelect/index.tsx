// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createSignal, For, Show } from "solid-js";

export interface MultiSelectOption {
  id: string;
  displayName: string;
  /// Hex color (no `#`) — used to tint label-shaped options.
  color?: string;
  avatarUrl?: string;
}

interface MultiSelectProps {
  /// All available options. The dropdown filters this list by the
  /// user's search input (substring match on `displayName`).
  options: MultiSelectOption[];
  /// Currently selected option IDs.
  selected: string[];
  /// Called with the next selected ID set when the user adds/removes
  /// a chip. The parent owns the state.
  onChange: (next: string[]) => void;
  /// Placeholder shown when no chips are selected.
  placeholder?: string;
  /// Disable user interaction (loading state, etc).
  disabled?: boolean;
  /// Render avatar-style decoration on chips + rows. Defaults to
  /// false; label-shaped options pick the color path instead.
  showAvatars?: boolean;
}

/// Multi-select combobox with chip render + searchable input +
/// filtered dropdown. Mirrors GK's react-select-style behaviour
/// (substring filter, "No match" empty state, isClearable per chip).
export function MultiSelect(props: MultiSelectProps) {
  const [query, setQuery] = createSignal("");
  const [focused, setFocused] = createSignal(false);

  const byId = createMemo(() => {
    const map = new Map<string, MultiSelectOption>();
    for (const o of props.options) map.set(o.id, o);
    return map;
  });

  const selectedOptions = createMemo(() =>
    props.selected
      .map((id) => byId().get(id))
      .filter((o): o is MultiSelectOption => o !== undefined),
  );

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const selectedSet = new Set(props.selected);
    return props.options.filter((o) => {
      if (selectedSet.has(o.id)) return false;
      if (q.length === 0) return true;
      return o.displayName.toLowerCase().includes(q);
    });
  });

  function add(id: string) {
    if (props.disabled) return;
    props.onChange([...props.selected, id]);
    setQuery("");
  }

  function remove(id: string) {
    if (props.disabled) return;
    props.onChange(props.selected.filter((s) => s !== id));
  }

  function onInputKeyDown(e: KeyboardEvent) {
    if (e.key === "Backspace" && query().length === 0 && props.selected.length > 0) {
      e.preventDefault();
      remove(props.selected[props.selected.length - 1]);
    }
  }

  return (
    <div class="multi-select" data-focused={focused() ? "true" : "false"}>
      <div class="multi-select__chips">
        <For each={selectedOptions()}>
          {(o) => (
            <span class="multi-select__chip" style={chipStyle(o, props.showAvatars)}>
              <Show when={props.showAvatars && o.avatarUrl}>
                <img class="multi-select__chip-avatar" src={o.avatarUrl} alt="" loading="lazy" />
              </Show>
              <span class="multi-select__chip-label">{o.displayName}</span>
              <button
                type="button"
                class="multi-select__chip-remove"
                aria-label={`Remove ${o.displayName}`}
                disabled={props.disabled}
                onClick={() => remove(o.id)}
              >
                ×
              </button>
            </span>
          )}
        </For>
        <input
          class="multi-select__input"
          type="text"
          value={query()}
          placeholder={
            selectedOptions().length === 0 ? (props.placeholder ?? "Search…") : ""
          }
          disabled={props.disabled}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={onInputKeyDown}
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
                    add(o.id);
                  }}
                >
                  <Show when={props.showAvatars && o.avatarUrl}>
                    <img
                      class="multi-select__option-avatar"
                      src={o.avatarUrl}
                      alt=""
                      loading="lazy"
                    />
                  </Show>
                  <Show when={!props.showAvatars && o.color}>
                    <span
                      class="multi-select__option-swatch"
                      style={{ "background-color": `#${o.color}` }}
                    />
                  </Show>
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

function chipStyle(o: MultiSelectOption, showAvatars: boolean | undefined) {
  if (showAvatars) return {};
  if (!o.color) return {};
  return {
    "background-color": `#${o.color}`,
    color: pickReadableTextColor(o.color),
  };
}

/// Simple luminance test → black or white. Mirrors the heuristic GK
/// uses on coloured label chips (so the text stays readable on both
/// dark and light label colours).
function pickReadableTextColor(hex: string): string {
  if (hex.length !== 6) return "var(--fg-0)";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#000" : "#fff";
}
