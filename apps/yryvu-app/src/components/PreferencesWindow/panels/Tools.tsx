// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createSignal, type JSX } from "solid-js";

import type { ExternalTerminal } from "../../../ipc";
import { preferences, updatePreferences } from "../../../state/preferences";

/// Empty or whitespace-only strings collapse to `null` so users can
/// clear a field by selecting + deleting. The backend treats `null` as
/// "not configured" and surfaces an error toast at launch instead of
/// guessing a terminal across platforms (per #105 design).
function normalize(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * External tools preferences panel — terminal binary + argument
 * template (issue #338, wave 2 of #105). Backend in PR #331.
 *
 * Local signals drive the inputs so typing stays responsive; commits
 * happen on `change` (browser fires this on blur/Enter), not per
 * keystroke, to avoid hammering the backend.
 */
export function ToolsPanel(): JSX.Element {
  const [pathLocal, setPathLocal] = createSignal("");
  const [argsLocal, setArgsLocal] = createSignal("");

  createEffect(() => {
    const prefs = preferences();
    if (!prefs) return;
    setPathLocal(prefs.tools.externalTerminal.path ?? "");
    setArgsLocal(prefs.tools.externalTerminal.args ?? "");
  });

  const persist = (next: Partial<ExternalTerminal>) => {
    const prefs = preferences();
    if (!prefs) return;
    void updatePreferences({
      tools: {
        externalTerminal: {
          ...prefs.tools.externalTerminal,
          ...next,
        },
      },
    });
  };

  const ready = () => preferences() !== undefined;

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">External terminal</h3>
      <p class="ui-panel__helper">
        Yryvu launches your terminal of choice from the toolbar and
        context menus. Leave a field blank to clear it — launches with
        no path configured surface an error toast instead of guessing.
      </p>

      <div class="tools-panel__field">
        <label class="ui-panel__label" for="tools-panel-path">
          Terminal binary
        </label>
        <input
          id="tools-panel-path"
          class="tools-panel__input"
          type="text"
          placeholder="/usr/bin/kgx"
          value={pathLocal()}
          disabled={!ready()}
          onInput={(e) => setPathLocal(e.currentTarget.value)}
          onChange={(e) =>
            persist({ path: normalize(e.currentTarget.value) })
          }
        />
        <p class="ui-panel__helper">
          Absolute path to your terminal executable.
        </p>
      </div>

      <div class="tools-panel__field">
        <label class="ui-panel__label" for="tools-panel-args">
          Argument template
        </label>
        <input
          id="tools-panel-args"
          class="tools-panel__input"
          type="text"
          placeholder="--working-directory={cwd}"
          value={argsLocal()}
          disabled={!ready()}
          onInput={(e) => setArgsLocal(e.currentTarget.value)}
          onChange={(e) =>
            persist({ args: normalize(e.currentTarget.value) })
          }
        />
        <p class="ui-panel__helper">
          Shell-quoted arguments. <code>{"{cwd}"}</code> is replaced with
          the repository path at launch time.
        </p>
      </div>
    </div>
  );
}
