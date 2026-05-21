// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createMemo, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";

import {
  closeCommandPalette,
  commandPalette,
} from "./state";
import type { SearchMode } from "../../ipc";
import "./style.css";

const MODE_LABELS: Record<SearchMode, string> = {
  commits: "Commits",
  files: "Files",
  branches: "Branches",
  tags: "Tags",
  stashes: "Stashes",
};

export function CommandPalette() {
  let inputRef: HTMLInputElement | undefined;

  // Focus the input every time the palette opens.
  createEffect(() => {
    if (commandPalette.open() && inputRef) {
      queueMicrotask(() => inputRef?.focus());
    }
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (!commandPalette.open()) return;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeCommandPalette();
        return;
      case "ArrowDown":
        e.preventDefault();
        commandPalette.moveSelection(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        commandPalette.moveSelection(-1);
        return;
      case "Enter":
        e.preventDefault();
        void commandPalette.activate();
        return;
      case "Tab":
        e.preventDefault();
        commandPalette.cycleMode(e.shiftKey ? -1 : 1);
        return;
    }
  };

  onMount(() => {
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));
  });

  return (
    <Show when={commandPalette.open()}>
      <Portal>
        <div class="palette-backdrop" onClick={closeCommandPalette}>
          <div class="palette" onClick={(e) => e.stopPropagation()}>
            <ModeTabs />
            <input
              ref={inputRef}
              class="palette-input"
              type="text"
              placeholder={placeholderFor(commandPalette.mode())}
              value={commandPalette.query()}
              onInput={(e) => commandPalette.setQueryAndSearch(e.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
            />
            <Show when={commandPalette.error()}>
              <div class="palette-error" role="alert">
                {commandPalette.error()}
              </div>
            </Show>
            <ResultList />
            <Footer />
          </div>
        </div>
      </Portal>
    </Show>
  );
}

function placeholderFor(mode: SearchMode): string {
  switch (mode) {
    case "commits":
      return "Search commits by message, sha or author";
    case "files":
      return "Search files by path";
    case "branches":
      return "Search branches";
    case "tags":
      return "Search tags";
    case "stashes":
      return "Search stashes";
  }
}

function ModeTabs() {
  return (
    <div class="palette-modes" role="tablist">
      <For each={commandPalette.MODES}>
        {(m) => (
          <button
            type="button"
            role="tab"
            class="palette-mode"
            classList={{ "palette-mode--active": commandPalette.mode() === m }}
            onClick={() => commandPalette.setMode(m)}
          >
            {MODE_LABELS[m]}
            <span class="palette-mode-count">{countFor(m)}</span>
          </button>
        )}
      </For>
    </div>
  );
}

function countFor(m: SearchMode): number {
  const c = commandPalette.counts();
  return (c as unknown as Record<SearchMode, number>)[m] ?? 0;
}

function ResultList() {
  const empty = createMemo(
    () => !commandPalette.busy() && commandPalette.hits().length === 0,
  );
  return (
    <div class="palette-results" role="listbox">
      <Show when={empty()}>
        <div class="palette-empty">
          {commandPalette.query().length === 0
            ? `No ${commandPalette.mode()} in this repository.`
            : "No matches."}
        </div>
      </Show>
      <For each={commandPalette.hits()}>
        {(hit, idx) => (
          <div
            class="palette-row"
            classList={{ "palette-row--active": idx() === commandPalette.activeIdx() }}
            role="option"
            aria-selected={idx() === commandPalette.activeIdx()}
            onClick={() => void commandPalette.activate(hit)}
          >
            <span class="palette-row-label">{hit.label || "(empty)"}</span>
            <span class="palette-row-sublabel">{hit.sublabel}</span>
          </div>
        )}
      </For>
    </div>
  );
}

function Footer() {
  return (
    <div class="palette-footer">
      <span><kbd>↑↓</kbd> navigate</span>
      <span><kbd>Tab</kbd> cycle mode</span>
      <span><kbd>Enter</kbd> open</span>
      <span><kbd>Esc</kbd> close</span>
    </div>
  );
}
