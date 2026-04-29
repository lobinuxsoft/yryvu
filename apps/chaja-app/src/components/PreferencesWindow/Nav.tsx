// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, type JSX } from "solid-js";
import {
  activePreferenceSection,
  setActivePreferenceSection,
  type PreferenceSectionId,
} from "../../state";
import { SECTIONS } from "./sections";

/**
 * Sidebar nav for the preferences window. 1:1 GK shape: 180 px fixed,
 * icon + label per row, active row highlighted with the accent color.
 */
export function Nav(): JSX.Element {
  const isActive = (id: PreferenceSectionId) => activePreferenceSection() === id;
  return (
    <nav class="preferences__nav" aria-label="Preference sections">
      <For each={SECTIONS}>
        {(section) => (
          <button
            class="preferences__nav-item"
            classList={{ "preferences__nav-item--active": isActive(section.id) }}
            type="button"
            role="tab"
            aria-selected={isActive(section.id)}
            tabIndex={isActive(section.id) ? 0 : -1}
            onClick={() => setActivePreferenceSection(section.id)}
          >
            <span class="preferences__nav-icon">{section.icon()}</span>
            <span class="preferences__nav-label">{section.label}</span>
          </button>
        )}
      </For>
    </nav>
  );
}
