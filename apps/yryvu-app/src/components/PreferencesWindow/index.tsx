// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

import {
  activePreferenceSection,
  closePreferences,
  preferencesOpen,
} from "../../state";
import { Nav } from "./Nav";
import { findSection } from "./sections";

/**
 * Preferences window — modal full-screen overlay with a left nav and a
 * right content pane. 1:1 layout from GK's `PreferenceView` (`render.bundle.js`
 * around 3424765); chajá renders it as a centered modal instead of a pinned
 * tab because chajá doesn't have a tab system yet.
 *
 * Behavior:
 * - Esc closes the window.
 * - Clicking the backdrop closes the window.
 * - Tab cycles focus inside the window (focus trap).
 * - Active section is restored from the persisted `activePreferenceSection`
 *   signal so reopening lands on the last visited panel.
 */
export function PreferencesWindow(): JSX.Element {
  return (
    <Show when={preferencesOpen()}>
      <PreferencesWindowBody />
    </Show>
  );
}

function PreferencesWindowBody(): JSX.Element {
  let windowRef: HTMLDivElement | undefined;
  let lastFocus: HTMLElement | null = null;

  const activePanel = createMemo(() => findSection(activePreferenceSection()).panel());
  const activeLabel = createMemo(() => findSection(activePreferenceSection()).label);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePreferences();
      return;
    }
    if (e.key === "Tab" && windowRef) {
      const focusable = windowRef.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  onMount(() => {
    lastFocus = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", onKeyDown, true);
    queueMicrotask(() => {
      const activeNav = windowRef?.querySelector<HTMLElement>(
        ".preferences__nav-item--active",
      );
      activeNav?.focus();
    });
  });
  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown, true);
    lastFocus?.focus?.();
  });

  return (
    <Portal>
      <div
        class="preferences__backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) closePreferences();
        }}
      >
        <div
          ref={windowRef}
          class="preferences"
          role="dialog"
          aria-modal="true"
          aria-label="Preferences"
        >
          <header class="preferences__header">
            <h2 class="preferences__title">Preferences</h2>
            <button
              class="preferences__close"
              type="button"
              aria-label="Close preferences"
              onClick={closePreferences}
            >
              ×
            </button>
          </header>
          <div class="preferences__layout">
            <Nav />
            <section
              class="preferences__content"
              role="tabpanel"
              aria-label={activeLabel()}
            >
              <h3 class="preferences__section-title">{activeLabel()}</h3>
              <div class="preferences__section-body">{activePanel()}</div>
            </section>
          </div>
        </div>
      </div>
    </Portal>
  );
}
