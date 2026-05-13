// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, createEffect, createSignal, type JSX } from "solid-js";

import type { EditorPreferences, EolCharacter } from "../../../ipc";
import { preferences, updatePreferences } from "../../../state/preferences";

const TAB_SIZE_MIN = 1;
const TAB_SIZE_MAX = 16;

function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

type BoolField = "wordWrap" | "showLineNumbers" | "syntaxHighlighting";

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
 * Editor preferences panel — formatting + display (issue #342, wave 2
 * of #190; trimmed by #344). Backend in PR #332. DiffView / FileDiffTab
 * consumer wiring lands in a separate follow-up.
 *
 * Font / fontSize / showOnlyMonospace lived here originally; #344
 * dropped them because UI themes already define `--font-mono` and
 * `UiPreferences.zoom` scales globally — having a second knob for the
 * same value was redundant.
 *
 * Tab-size keeps its local signal as a string so the input can be
 * momentarily empty during editing; persistence parses + clamps to
 * the safe range and falls back to the currently-persisted value on
 * a typo (not `min`, so the user doesn't lose their setting).
 *
 * The EOL `<select>` follows Ui.tsx's ref-imperative pattern —
 * declarative `selected=` loses to browser user-interaction tracking
 * once the user has touched the control.
 */
export function EditorPanel(): JSX.Element {
  let eolSelectRef: HTMLSelectElement | undefined;

  const [tabSizeLocal, setTabSizeLocal] = createSignal("");

  createEffect(() => {
    const prefs = preferences();
    if (!prefs) return;
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

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Formatting</h3>
      <p class="ui-panel__helper">
        These settings apply to diff and file views. The editor font and
        size come from your active theme (UI section) and the global
        zoom; this panel covers everything else.
      </p>

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
