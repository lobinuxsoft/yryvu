// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show, createMemo, type JSX } from "solid-js";

import {
  createThemeFromTemplate,
  openThemesFolder,
  type ThemeEntry,
} from "../../../ipc";
import { preferences, updatePreferences } from "../../../state/preferences";
import {
  colorScheme,
  refetchThemes,
  resolveActiveThemeId,
  themes,
} from "../../../themes";

const AUTO_ID = "auto";
const AUTO_LABEL = "Auto (follow OS)";

/**
 * UI preferences panel — theme switcher (#292 sub-PR A). Density (#294),
 * font scale (#293), tooltips/animations (#295) follow.
 */
export function UiPanel(): JSX.Element {
  const list = createMemo<readonly ThemeEntry[]>(() => themes() ?? []);

  const activePreferenceId = createMemo<string | null>(() => {
    const prefs = preferences();
    return prefs ? prefs.ui.theme : null;
  });

  const resolvedId = createMemo<string | null>(() => {
    const id = activePreferenceId();
    if (id === null) return null;
    return resolveActiveThemeId(id, list(), colorScheme());
  });

  const sortedThemes = createMemo<ThemeEntry[]>(() =>
    [...list()].sort((a, b) => a.id.localeCompare(b.id)),
  );

  const onChange = (e: Event & { currentTarget: HTMLSelectElement }) => {
    const next = e.currentTarget.value;
    if (next === activePreferenceId()) return;
    void updatePreferences({ ui: { theme: next } });
  };

  const onCreateFromTemplate = async () => {
    try {
      await createThemeFromTemplate("a-default");
      await refetchThemes();
      await openThemesFolder();
    } catch (err) {
      console.error("create theme from template failed:", err);
    }
  };

  const onOpenFolder = () => {
    void openThemesFolder();
  };

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Appearance</h3>

      <div class="ui-panel__field">
        <label class="ui-panel__label" for="ui-panel-theme">Theme</label>
        <select
          id="ui-panel-theme"
          class="ui-panel__select"
          value={activePreferenceId() ?? AUTO_ID}
          onChange={onChange}
          disabled={activePreferenceId() === null}
        >
          <option value={AUTO_ID}>{AUTO_LABEL}</option>
          <For each={sortedThemes()}>
            {(t) => (
              <option value={t.id}>
                {t.name}
                {t.builtIn ? "" : " (Custom)"}
              </option>
            )}
          </For>
        </select>
        <Show when={activePreferenceId() === AUTO_ID && resolvedId()}>
          <p class="ui-panel__helper">
            Currently <strong>{resolvedId()}</strong> (OS prefers{" "}
            <strong>{colorScheme()}</strong>).
          </p>
        </Show>
      </div>

      <div class="ui-panel__actions">
        <button
          type="button"
          class="ui-panel__btn"
          onClick={onCreateFromTemplate}
        >
          New theme from template
        </button>
        <button
          type="button"
          class="ui-panel__btn ui-panel__btn--secondary"
          onClick={onOpenFolder}
        >
          Open themes folder
        </button>
      </div>
      <p class="ui-panel__helper">
        Custom themes live under your config directory. Edit
        <code>tokens.css</code> and reopen the panel to see changes — live
        reload arrives in a follow-up commit.
      </p>
    </div>
  );
}
