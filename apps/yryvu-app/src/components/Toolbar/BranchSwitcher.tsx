// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";

import { IconChevronDown } from "../Icons";
import { Tooltip } from "../Tooltip";
import { type BranchInfo } from "../../ipc";
import { useBranchOps } from "../../branchOps";

interface BranchSwitcherProps {
  branches: BranchInfo[];
  active?: BranchInfo;
}

/**
 * Toolbar branch switcher. The button shows the active branch name;
 * clicking opens a dropdown with a filter input and the list of local
 * branches. Each row mirrors the LeftSidebar entry: short name + ahead /
 * behind pills if an upstream is configured. Click → `tryCheckout`
 * (which prompts the auto-stash dialog when the working tree is dirty).
 *
 * Remote-branch checkout (auto-create local tracking) is intentionally
 * out of scope for the first cut — the LeftSidebar already lists remote
 * refs, and the typical toolbar flow is "switch local branch".
 */
export function BranchSwitcher(props: BranchSwitcherProps) {
  let wrapperEl: HTMLDivElement | undefined;
  let filterInput: HTMLInputElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  const ops = useBranchOps();

  onMount(() => {
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

  // Local branches only (remote checkout would need an auto-create-tracking
  // path that the LeftSidebar already handles via its context menu).
  const locals = createMemo(() =>
    props.branches.filter((b) => b.kind === "local"),
  );

  const filtered = createMemo(() => {
    const q = filter().trim().toLowerCase();
    if (!q) return locals();
    return locals().filter((b) => b.name.toLowerCase().includes(q));
  });

  function onTrigger() {
    const willOpen = !open();
    setOpen(willOpen);
    if (willOpen) {
      setFilter("");
      // Solid renders the panel synchronously; queueMicrotask focuses the
      // input after the DOM has the element.
      queueMicrotask(() => filterInput?.focus());
    }
  }

  function pick(branch: BranchInfo) {
    if (branch.is_head) {
      setOpen(false);
      return;
    }
    setOpen(false);
    void ops.tryCheckout(branch.name);
  }

  return (
    <div class="toolbar__selector toolbar-switcher" ref={wrapperEl}>
      <span>branch</span>
      <button
        type="button"
        class="toolbar__selector-value toolbar-switcher__trigger"
        aria-expanded={open()}
        onClick={onTrigger}
      >
        <Show when={props.active} fallback={<em>— </em>}>
          {(active) => <span class="toolbar-switcher__active">{active().name}</span>}
        </Show>
        <span class="toolbar-switcher__caret" classList={{ "toolbar-switcher__caret--open": open() }}>
          <IconChevronDown width="10" height="10" />
        </span>
      </button>
      <Show when={open()}>
        <div class="toolbar-switcher__panel toolbar-switcher__panel--branches" role="dialog">
          <input
            ref={filterInput}
            type="text"
            class="toolbar-switcher__filter"
            placeholder="Filter branches…"
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
          />
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="toolbar-switcher__empty">
                <Show when={locals().length === 0} fallback={<>No matches.</>}>
                  No local branches.
                </Show>
              </div>
            }
          >
            <ul class="toolbar-switcher__list">
              <For each={filtered()}>
                {(branch) => (
                  <li>
                    <Tooltip text={branch.full_name}>
                    <button
                      type="button"
                      class="toolbar-switcher__item toolbar-switcher__item--branch"
                      classList={{
                        "toolbar-switcher__item--active": branch.is_head,
                      }}
                      role="menuitem"
                      onClick={() => pick(branch)}
                    >
                      <span class="toolbar-switcher__item-name">{branch.name}</span>
                      <Show when={branch.upstream}>
                        <span class="toolbar-switcher__counts">
                          <Show when={branch.behind > 0}>
                            <span class="toolbar-switcher__behind">↓{branch.behind > 99 ? "99+" : branch.behind}</span>
                          </Show>
                          <Show when={branch.ahead > 0}>
                            <span class="toolbar-switcher__ahead">↑{branch.ahead > 99 ? "99+" : branch.ahead}</span>
                          </Show>
                        </span>
                      </Show>
                    </button>
                    </Tooltip>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </div>
  );
}
