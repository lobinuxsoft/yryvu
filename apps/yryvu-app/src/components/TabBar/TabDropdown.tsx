// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dropdown popover that lists Open Tabs + Closed Recently with a single
 * substring filter. Single click handler routes to `selectTab` (Open
 * Tabs) or `reopenTab` (Closed Recently) based on which group the row
 * belongs to (audit doc 04).
 *
 * Position: Portal-rendered, positioned by the parent (TabBar) which
 * captures the chevron button's bounding rect on every open. This
 * matches the existing `HiddenRefsButton` pattern.
 *
 * Auto-close triggers:
 *   - ESC key             → closeTabDropdown()
 *   - Click outside       → closeTabDropdown()
 *   - Row click           → closeTabDropdown() + dispatch
 *   - Preferences open    → handled in tabs/state.ts createEffect
 *
 * The audit doc 04 modal allowlist (ABOUT/ACTIVITY_LOG/CREATE_FILE/
 * FUZZY_FINDER) collapses to "skip if Preferences open" in chajá v1 —
 * none of the GK modals exist here, and a closed dropdown when prefs
 * is open is friendlier than auto-closing the prefs window.
 */

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";

import { NfIcon } from "../NfIcon";
import { Tooltip } from "../Tooltip";
import { performTabOperation } from "../../tabs/dispatcher";
import { closeTabDropdown, closedTabs, tabs } from "../../tabs/state";
import { type ClosedTab, type Tab } from "../../tabs/types";
import { filterByTitle, titleOf } from "./tabTitle";

interface Props {
  /// Coordinates of the chevron's bottom-left edge in viewport space —
  /// the popover anchors its top-left corner here. TabBar captures this
  /// at open time via `getBoundingClientRect()`.
  anchor: { top: number; left: number };
}

/// Icon for each tab type — single-glyph PUA codepoint via NfIcon.
function iconCodeOf(tab: Tab): string {
  switch (tab.type) {
    case "REPO":
      return "f1c0"; // nf-fa-database (repo proxy — folder-tree alternatives drift across icons)
    case "NEW":
      return "f067"; // nf-fa-plus
    case "RELEASE_NOTES":
      return "f02b"; // nf-fa-tag
  }
}

export function TabDropdown(props: Props) {
  let inputEl: HTMLInputElement | undefined;
  let popoverEl: HTMLDivElement | undefined;
  const [query, setQuery] = createSignal("");

  // Auto-focus the filter on mount so the user can start typing
  // immediately. Same pattern as the GK component (bundle:375658).
  onMount(() => {
    inputEl?.focus();
  });

  // Filter both sections by case-insensitive substring on the title.
  // Using a single memo keeps both sections re-derived in lockstep when
  // the query changes.
  const filtered = createMemo(() => ({
    open: filterByTitle(tabs(), titleOf, query()),
    closed: filterByTitle(closedTabs(), (c) => titleOf(c.tab), query()),
  }));

  const handleSelectOpen = (tabId: string) => {
    void performTabOperation({ type: "SWITCH_TO", tabId });
    closeTabDropdown();
  };

  const handleReopen = (tabId: string) => {
    void performTabOperation({ type: "REOPEN", tabId });
    closeTabDropdown();
  };

  const handleClose = (tabId: string, e: MouseEvent) => {
    e.stopPropagation();
    void performTabOperation({ type: "CLOSE", tabId });
  };

  // ESC + click-outside dismissal. Copy of the HiddenRefsButton pattern
  // — listeners attach when the popover mounts and detach on cleanup.
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTabDropdown();
    };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverEl?.contains(t)) return;
      // Don't close when the click landed on the chevron itself — that
      // click triggers toggleTabDropdown which already handles the
      // close path.
      if ((t as HTMLElement)?.closest?.(".tabs__dropdown")) return;
      closeTabDropdown();
    };
    document.addEventListener("keydown", onKey);
    // mousedown rather than click so the close fires before the click
    // event bubbles through to a form / dialog underneath.
    document.addEventListener("mousedown", onDoc);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    });
  });

  const isEmpty = () =>
    filtered().open.length === 0 && filtered().closed.length === 0;

  return (
    <Portal>
      <div
        ref={popoverEl}
        class="tab-dropdown"
        style={{
          position: "fixed",
          top: `${props.anchor.top}px`,
          left: `${props.anchor.left}px`,
        }}
        role="dialog"
        aria-label="Tab menu"
      >
        <input
          ref={inputEl}
          class="tab-dropdown__filter"
          type="text"
          placeholder="Search tabs"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          aria-label="Filter tabs"
        />
        <Show when={isEmpty()}>
          <div class="tab-dropdown__empty">
            {query().length > 0
              ? `No tabs match "${query()}"`
              : "No open or recently closed tabs"}
          </div>
        </Show>
        <Show when={filtered().open.length > 0}>
          <div class="tab-dropdown__section">
            <div class="tab-dropdown__section-title">Open Tabs</div>
            <For each={filtered().open}>
              {(t) => (
                <div
                  class="tab-dropdown__row"
                  role="button"
                  tabindex={0}
                  onClick={() => handleSelectOpen(t.id)}
                >
                  <span class="tab-dropdown__row-icon nf">
                    <NfIcon code={iconCodeOf(t)} />
                  </span>
                  <span class="tab-dropdown__row-title">{titleOf(t)}</span>
                  <Tooltip text="Close tab">
                    <button
                      class="tab-dropdown__row-close"
                      type="button"
                      aria-label={`Close ${titleOf(t)}`}
                      onClick={(e) => handleClose(t.id, e)}
                    >
                      <NfIcon code="f00d" />
                    </button>
                  </Tooltip>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={filtered().closed.length > 0}>
          <div class="tab-dropdown__section">
            <div class="tab-dropdown__section-title">Closed Recently</div>
            <For each={[...filtered().closed].reverse()}>
              {(c: ClosedTab) => (
                <div
                  class="tab-dropdown__row"
                  role="button"
                  tabindex={0}
                  onClick={() => handleReopen(c.tab.id)}
                >
                  <span class="tab-dropdown__row-icon nf">
                    <NfIcon code={iconCodeOf(c.tab)} />
                  </span>
                  <span class="tab-dropdown__row-title">{titleOf(c.tab)}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Portal>
  );
}
