// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show, createEffect, createMemo, type JSX } from "solid-js";

import {
  createThemeFromTemplate,
  openThemesFolder,
  type AnimationMode,
  type ThemeEntry,
} from "../../../ipc";
import { preferences, updatePreferences } from "../../../state/preferences";
import { Tooltip } from "../../Tooltip";
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
  let selectRef: HTMLSelectElement | undefined;

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

  // Entry whose id matches the resolved-active id, or null if the
  // themes list hasn't loaded or the active id no longer exists.
  const activeEntry = createMemo<ThemeEntry | null>(() => {
    const id = resolvedId();
    if (!id) return null;
    return list().find((t) => t.id === id) ?? null;
  });

  // Imperatively reflect the active id onto the <select>'s `value`
  // *property* whenever it changes. Declarative `value=` / `selected=`
  // both lose to the browser's user-interaction tracking once the user
  // has touched the select once — the property setter is the only path
  // that consistently wins. Depending on `sortedThemes()` ensures the
  // effect runs *after* the For has rendered the matching <option>.
  createEffect(() => {
    const id = activePreferenceId();
    sortedThemes();
    if (selectRef && id !== null && selectRef.value !== id) {
      selectRef.value = id;
    }
  });

  const onChange = (e: Event & { currentTarget: HTMLSelectElement }) => {
    const next = e.currentTarget.value;
    if (next === activePreferenceId()) return;
    void updatePreferences({ ui: { theme: next } });
  };

  const onDuplicateActive = async () => {
    const source = activeEntry();
    if (!source || !source.builtIn) return;
    try {
      await createThemeFromTemplate(source.id);
      await refetchThemes();
      await openThemesFolder();
    } catch (err) {
      console.error("duplicate theme failed:", err);
    }
  };

  const onOpenFolder = () => {
    void openThemesFolder();
  };

  // Tooltip + animation rows (#316). Read straight from `preferences()`
  // and persist via `updatePreferences` patches — same pattern as theme.
  const tooltipsEnabled = createMemo<boolean>(
    () => preferences()?.ui.tooltipsEnabled ?? true,
  );
  const tooltipDelayMs = createMemo<number>(
    () => preferences()?.ui.tooltipDelayMs ?? 500,
  );
  const animations = createMemo<AnimationMode>(
    () => preferences()?.ui.animations ?? "system",
  );

  const onTooltipsEnabledChange = (e: Event & { currentTarget: HTMLInputElement }) => {
    void updatePreferences({ ui: { tooltipsEnabled: e.currentTarget.checked } });
  };
  const onTooltipDelayChange = (e: Event & { currentTarget: HTMLInputElement }) => {
    const raw = Number(e.currentTarget.value);
    if (!Number.isFinite(raw)) return;
    const clamped = Math.max(0, Math.min(2000, Math.round(raw)));
    void updatePreferences({ ui: { tooltipDelayMs: clamped } });
  };
  const onAnimationsChange = (e: Event & { currentTarget: HTMLSelectElement }) => {
    void updatePreferences({
      ui: { animations: e.currentTarget.value as AnimationMode },
    });
  };

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Appearance</h3>

      <div class="ui-panel__field">
        <label class="ui-panel__label" for="ui-panel-theme">Theme</label>
        <select
          ref={selectRef}
          id="ui-panel-theme"
          class="ui-panel__select"
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
        <Tooltip
          text={
            activeEntry()?.builtIn === false
              ? "Custom themes can't be used as a template — switch to a built-in first."
              : null
          }
        >
          <button
            type="button"
            class="ui-panel__btn"
            onClick={onDuplicateActive}
            disabled={!activeEntry() || !activeEntry()?.builtIn}
          >
            {activeEntry()
              ? `Duplicate "${activeEntry()!.name}" as new theme`
              : "Duplicate active theme"}
          </button>
        </Tooltip>
        <button
          type="button"
          class="ui-panel__btn ui-panel__btn--secondary"
          onClick={onOpenFolder}
        >
          Open themes folder
        </button>
      </div>
      <p class="ui-panel__helper">
        Pick any built-in as your starting point — synthwave's neon glows,
        kanagawa's sumi-e shadows, dracula's gradients all come baked in.
        Edit <code>tokens.css</code> for colors and <code>personality.css</code>
        for animations / button shapes / decorative effects. Live reload
        repaints within ~200 ms.
      </p>

      <h3 class="preferences__section-title">Tooltips &amp; motion</h3>

      <div class="ui-panel__field">
        <label class="ui-panel__checkbox">
          <input
            type="checkbox"
            checked={tooltipsEnabled()}
            disabled={preferences() === undefined}
            onChange={onTooltipsEnabledChange}
          />
          Show tooltips on hover
        </label>
        <p class="ui-panel__helper">
          When off, hover hints stay invisible; screen readers still
          read the underlying <code>aria-label</code>.
        </p>
      </div>

      <div class="ui-panel__field">
        <label class="ui-panel__label" for="ui-panel-tooltip-delay">
          Tooltip delay (ms)
        </label>
        <input
          id="ui-panel-tooltip-delay"
          type="number"
          class="ui-panel__select"
          min="0"
          max="2000"
          step="100"
          value={tooltipDelayMs()}
          disabled={!tooltipsEnabled() || preferences() === undefined}
          onChange={onTooltipDelayChange}
        />
        <p class="ui-panel__helper">
          How long to wait before the bubble appears. 0 = instant.
        </p>
      </div>

      <div class="ui-panel__field">
        <label class="ui-panel__label" for="ui-panel-animations">Animations</label>
        <select
          id="ui-panel-animations"
          class="ui-panel__select"
          value={animations()}
          disabled={preferences() === undefined}
          onChange={onAnimationsChange}
        >
          <option value="always">Always</option>
          <option value="system">System (follow OS reduced-motion)</option>
          <option value="never">Never</option>
        </select>
        <p class="ui-panel__helper">
          <strong>System</strong> honors <code>prefers-reduced-motion</code>
          live; <strong>Never</strong> kills every transition + animation
          except loading spinners.
        </p>
      </div>
    </div>
  );
}
