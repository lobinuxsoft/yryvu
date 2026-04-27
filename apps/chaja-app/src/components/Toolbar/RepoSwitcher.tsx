// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

import { IconChevronDown, IconOpenFolder } from "../Icons";
import {
  loadRecentRepos,
  pushRecentRepo,
  repoPath,
  setRepoPath,
  type RecentRepo,
} from "../../state";

interface RepoSwitcherProps {
  /** Triggered by the "Open another…" item — opens the file picker. */
  onOpenRepo: () => void;
}

/**
 * Toolbar repository switcher. The button shows the active repo's short
 * name; clicking opens a dropdown listing recent repos (up to 10, the
 * cap enforced by `pushRecentRepo`) with the active one highlighted.
 * "Open another…" at the bottom delegates to the AppShell file picker.
 */
export function RepoSwitcher(props: RepoSwitcherProps) {
  let wrapperEl: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [recents, setRecents] = createSignal<RecentRepo[]>([]);

  function refresh() {
    setRecents(loadRecentRepos());
  }

  onMount(() => {
    refresh();
    const onDocPointer = (e: MouseEvent) => {
      if (!open()) return;
      if (wrapperEl && !wrapperEl.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    });
  });

  function activeName(): string | undefined {
    const p = repoPath();
    if (!p) return undefined;
    return p.split("/").filter(Boolean).pop() ?? p;
  }

  function pick(entry: RecentRepo) {
    setOpen(false);
    pushRecentRepo(entry.path);
    setRepoPath(entry.path);
  }

  function onTrigger() {
    if (!open()) refresh();
    setOpen((v) => !v);
  }

  function onOpenAnother() {
    setOpen(false);
    props.onOpenRepo();
  }

  return (
    <div class="toolbar__selector toolbar-switcher" ref={wrapperEl}>
      <span>repository</span>
      <button
        type="button"
        class="toolbar__selector-value toolbar-switcher__trigger"
        aria-expanded={open()}
        onClick={onTrigger}
      >
        <Show when={activeName()} fallback={<em>No repo</em>}>
          {(name) => <span class="toolbar-switcher__active">{name()}</span>}
        </Show>
        <span class="toolbar-switcher__caret" classList={{ "toolbar-switcher__caret--open": open() }}>
          <IconChevronDown width="10" height="10" />
        </span>
      </button>
      <Show when={open()}>
        <div class="toolbar-switcher__panel" role="menu">
          <Show
            when={recents().length > 0}
            fallback={<div class="toolbar-switcher__empty">No recent repositories</div>}
          >
            <ul class="toolbar-switcher__list">
              <For each={recents()}>
                {(entry) => (
                  <li>
                    <button
                      type="button"
                      class="toolbar-switcher__item"
                      classList={{
                        "toolbar-switcher__item--active": entry.path === repoPath(),
                      }}
                      role="menuitem"
                      onClick={() => pick(entry)}
                    >
                      <span class="toolbar-switcher__item-name">{entry.name}</span>
                      <span class="toolbar-switcher__item-path">{entry.path}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <div class="toolbar-switcher__separator" />
          <button
            type="button"
            class="toolbar-switcher__item toolbar-switcher__item--action"
            role="menuitem"
            onClick={onOpenAnother}
          >
            <span class="toolbar-switcher__item-icon">
              <IconOpenFolder width="12" height="12" />
            </span>
            <span class="toolbar-switcher__item-name">Open another…</span>
          </button>
        </div>
      </Show>
    </div>
  );
}
