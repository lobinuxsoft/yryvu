// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, createEffect, createSignal, type JSX } from "solid-js";

import type { CommitPreferences } from "../../../ipc";
import { preferences, updatePreferences } from "../../../state/preferences";

/// Empty textarea → null. We don't trim; users may legitimately want
/// trailing newlines in their template (Git's commit-msg editor
/// preserves them). Only the all-empty case collapses to `null` =
/// "no template".
function normalize(raw: string): string | null {
  return raw.length === 0 ? null : raw;
}

type DefaultBoolField = Exclude<
  keyof CommitPreferences,
  "commitTemplate" | "useTemplateForCommitMessages"
>;

const DEFAULT_TOGGLES: ReadonlyArray<{
  field: DefaultBoolField;
  label: string;
  hint: string;
}> = [
  {
    field: "defaultPushAfterCommit",
    label: "Push after commit",
    hint: "Auto-push to the current upstream when a commit lands.",
  },
  {
    field: "defaultSkipGitHooks",
    label: "Skip Git hooks",
    hint: "Bypass pre-commit and commit-msg hooks by default.",
  },
  {
    field: "removeCommentsFromCommitMessages",
    label: "Strip comment lines",
    hint: "Drop lines starting with #, mirroring Git's commit.cleanup=strip.",
  },
];

/**
 * Commit preferences panel — template authoring + four defaults
 * (issue #340, wave 2 of #304). Backend in PR #330. Consumer wiring of
 * these prefs into `create_commit` lands in a separate follow-up.
 *
 * Toggle rows reuse `.notifications-panel__row` styling — when a third
 * panel needs toggles (Editor.tsx) those classes should be extracted to
 * a shared `toggle-row.css` namespace.
 */
export function CommitPanel(): JSX.Element {
  const [templateLocal, setTemplateLocal] = createSignal("");

  createEffect(() => {
    const prefs = preferences();
    if (!prefs) return;
    setTemplateLocal(prefs.commit.commitTemplate ?? "");
  });

  const persist = (patch: Partial<CommitPreferences>) => {
    if (!preferences()) return;
    void updatePreferences({ commit: patch });
  };

  const ready = () => preferences() !== undefined;

  const boolValue = (field: keyof CommitPreferences): boolean => {
    const prefs = preferences();
    return prefs ? (prefs.commit[field] as boolean) : false;
  };

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Template</h3>
      <p class="ui-panel__helper">
        Pre-fill new commit messages with a template. Clear the textarea
        to drop it. Enable the toggle below to apply the template when
        authoring a commit.
      </p>

      <div class="commit-panel__field">
        <label class="ui-panel__label" for="commit-panel-template">
          Commit template
        </label>
        <textarea
          id="commit-panel-template"
          class="commit-panel__textarea"
          rows={6}
          placeholder={"feat(scope): summary\n\nLonger description..."}
          value={templateLocal()}
          disabled={!ready()}
          onInput={(e) => setTemplateLocal(e.currentTarget.value)}
          onChange={(e) =>
            persist({ commitTemplate: normalize(e.currentTarget.value) })
          }
        />
      </div>

      <label class="notifications-panel__row">
        <input
          type="checkbox"
          class="notifications-panel__toggle"
          checked={boolValue("useTemplateForCommitMessages")}
          disabled={!ready()}
          onChange={(e) =>
            persist({ useTemplateForCommitMessages: e.currentTarget.checked })
          }
        />
        <span class="notifications-panel__label">
          <span class="notifications-panel__label-text">Use this template</span>
          <span class="notifications-panel__hint">
            Prefill the commit message editor with the template above.
          </span>
        </span>
      </label>

      <h3 class="preferences__section-title commit-panel__sub-heading">
        Defaults
      </h3>

      <div class="notifications-panel__rows">
        <For each={DEFAULT_TOGGLES}>
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
