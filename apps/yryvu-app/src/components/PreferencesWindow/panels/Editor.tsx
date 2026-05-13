// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, createEffect, createMemo, createSignal, type JSX } from "solid-js";

import type { EditorPreferences, EolCharacter } from "../../../ipc";
import { preferences, updatePreferences } from "../../../state/preferences";

/// Suggestion lists for the font `<datalist>`. There is no Tauri command
/// to enumerate system fonts today, so we curate common cross-platform
/// families. Free text remains valid — the datalist is hint-only.
const MONOSPACE_FONTS: readonly string[] = [
  "FiraCode Nerd Font Mono",
  "JetBrains Mono",
  "Cascadia Code",
  "Cascadia Mono",
  "Source Code Pro",
  "Iosevka",
  "Hack",
  "Inconsolata",
  "Menlo",
  "Monaco",
  "Consolas",
  "SF Mono",
  "DejaVu Sans Mono",
  "Liberation Mono",
  "Ubuntu Mono",
  "Courier New",
];

const PROPORTIONAL_FONTS: readonly string[] = [
  "Inter",
  "Roboto",
  "SF Pro Text",
  "Segoe UI",
  "Helvetica Neue",
  "Helvetica",
  "Arial",
  "Verdana",
  "system-ui",
  "sans-serif",
];

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;
const TAB_SIZE_MIN = 1;
const TAB_SIZE_MAX = 16;

function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

type BoolField =
  | "showOnlyMonospace"
  | "wordWrap"
  | "showLineNumbers"
  | "syntaxHighlighting";

const DISPLAY_TOGGLES: ReadonlyArray<{
  field: Extract<BoolField, "showLineNumbers" | "syntaxHighlighting">;
  label: string;
  hint: string;
}> = [
  {
    field: "showLineNumbers",
    label: "Show line numbers",
    hint: "Render the gutter with line numbers in diff and file views.",
  },
  {
    field: "syntaxHighlighting",
    label: "Syntax highlighting",
    hint: "Tokenize source with highlight.js for editor and diff views.",
  },
];

/**
 * Editor preferences panel — font, formatting, display (issue #342,
 * wave 2 of #190). Backend in PR #332. DiffView / FileDiffTab consumer
 * wiring lands in a separate follow-up.
 *
 * Numeric inputs keep their local signal as a string so the input can
 * be momentarily empty during editing; persistence parses + clamps to
 * the safe range. The EOL `<select>` follows Ui.tsx's ref-imperative
 * pattern — declarative `selected=` loses to browser user-interaction
 * tracking once the user has touched the control.
 *
 * Toggle rows reuse `.notifications-panel__*` selectors (4th panel with
 * toggles — extraction to `toggle-row.css` is a separate refactor PR).
 */
export function EditorPanel(): JSX.Element {
  let eolSelectRef: HTMLSelectElement | undefined;

  const [fontLocal, setFontLocal] = createSignal("");
  const [fontSizeLocal, setFontSizeLocal] = createSignal("");
  const [tabSizeLocal, setTabSizeLocal] = createSignal("");

  createEffect(() => {
    const prefs = preferences();
    if (!prefs) return;
    setFontLocal(prefs.editor.font);
    setFontSizeLocal(String(prefs.editor.fontSize));
    setTabSizeLocal(String(prefs.editor.tabSize));
  });

  createEffect(() => {
    const v = preferences()?.editor.eolCharacter;
    if (eolSelectRef && v && eolSelectRef.value !== v) {
      eolSelectRef.value = v;
    }
  });

  const persist = (patch: Partial<EditorPreferences>) => {
    if (!preferences()) return;
    void updatePreferences({ editor: patch });
  };

  const ready = () => preferences() !== undefined;

  const boolValue = (field: BoolField): boolean => {
    const prefs = preferences();
    return prefs ? (prefs.editor[field] as boolean) : false;
  };

  const showOnlyMonospace = () => boolValue("showOnlyMonospace");

  const fontSuggestions = createMemo<readonly string[]>(() =>
    showOnlyMonospace()
      ? MONOSPACE_FONTS
      : [...MONOSPACE_FONTS, ...PROPORTIONAL_FONTS],
  );

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Font</h3>
      <p class="ui-panel__helper">
        Type any installed font family — the suggestions below cover
        common monospace options; flip the toggle to also see
        proportional ones. Applies to diff and file views.
      </p>

      <div class="editor-panel__field">
        <label class="ui-panel__label" for="editor-panel-font">
          Font family
        </label>
        <input
          id="editor-panel-font"
          class="editor-panel__input"
          type="text"
          list="editor-panel-font-suggestions"
          placeholder="FiraCode Nerd Font Mono"
          value={fontLocal()}
          disabled={!ready()}
          onInput={(e) => setFontLocal(e.currentTarget.value)}
          onChange={(e) => persist({ font: e.currentTarget.value })}
        />
        <datalist id="editor-panel-font-suggestions">
          <For each={fontSuggestions()}>
            {(name) => <option value={name} />}
          </For>
        </datalist>
      </div>

      <div class="editor-panel__field editor-panel__field--narrow">
        <label class="ui-panel__label" for="editor-panel-font-size">
          Font size (px)
        </label>
        <input
          id="editor-panel-font-size"
          class="editor-panel__input editor-panel__input--numeric"
          type="number"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={1}
          value={fontSizeLocal()}
          disabled={!ready()}
          onInput={(e) => setFontSizeLocal(e.currentTarget.value)}
          onChange={(e) => {
            const fallback = preferences()?.editor.fontSize ?? FONT_SIZE_MIN;
            persist({
              fontSize: clampInt(
                e.currentTarget.value,
                fallback,
                FONT_SIZE_MIN,
                FONT_SIZE_MAX,
              ),
            });
          }}
        />
      </div>

      <label class="notifications-panel__row">
        <input
          type="checkbox"
          class="notifications-panel__toggle"
          checked={showOnlyMonospace()}
          disabled={!ready()}
          onChange={(e) =>
            persist({ showOnlyMonospace: e.currentTarget.checked })
          }
        />
        <span class="notifications-panel__label">
          <span class="notifications-panel__label-text">
            Monospace suggestions only
          </span>
          <span class="notifications-panel__hint">
            Filter the font family dropdown to fixed-width fonts.
          </span>
        </span>
      </label>

      <h3 class="preferences__section-title editor-panel__sub-heading">
        Formatting
      </h3>

      <div class="editor-panel__field editor-panel__field--narrow">
        <label class="ui-panel__label" for="editor-panel-eol">
          Line endings
        </label>
        <select
          ref={eolSelectRef}
          id="editor-panel-eol"
          class="editor-panel__select"
          disabled={!ready()}
          onChange={(e) =>
            persist({ eolCharacter: e.currentTarget.value as EolCharacter })
          }
        >
          <option value="lf">LF (Unix)</option>
          <option value="crlf">CRLF (Windows)</option>
        </select>
      </div>

      <div class="editor-panel__field editor-panel__field--narrow">
        <label class="ui-panel__label" for="editor-panel-tab-size">
          Tab size
        </label>
        <input
          id="editor-panel-tab-size"
          class="editor-panel__input editor-panel__input--numeric"
          type="number"
          min={TAB_SIZE_MIN}
          max={TAB_SIZE_MAX}
          step={1}
          value={tabSizeLocal()}
          disabled={!ready()}
          onInput={(e) => setTabSizeLocal(e.currentTarget.value)}
          onChange={(e) => {
            const fallback = preferences()?.editor.tabSize ?? TAB_SIZE_MIN;
            persist({
              tabSize: clampInt(
                e.currentTarget.value,
                fallback,
                TAB_SIZE_MIN,
                TAB_SIZE_MAX,
              ),
            });
          }}
        />
      </div>

      <label class="notifications-panel__row">
        <input
          type="checkbox"
          class="notifications-panel__toggle"
          checked={boolValue("wordWrap")}
          disabled={!ready()}
          onChange={(e) => persist({ wordWrap: e.currentTarget.checked })}
        />
        <span class="notifications-panel__label">
          <span class="notifications-panel__label-text">Word wrap</span>
          <span class="notifications-panel__hint">
            Soft-wrap long lines instead of horizontal scrolling.
          </span>
        </span>
      </label>

      <h3 class="preferences__section-title editor-panel__sub-heading">
        Display
      </h3>

      <div class="notifications-panel__rows">
        <For each={DISPLAY_TOGGLES}>
          {(row) => (
            <label class="notifications-panel__row">
              <input
                type="checkbox"
                class="notifications-panel__toggle"
                checked={boolValue(row.field)}
                disabled={!ready()}
                onChange={(e) =>
                  persist({ [row.field]: e.currentTarget.checked })
                }
              />
              <span class="notifications-panel__label">
                <span class="notifications-panel__label-text">{row.label}</span>
                <span class="notifications-panel__hint">{row.hint}</span>
              </span>
            </label>
          )}
        </For>
      </div>
    </div>
  );
}
