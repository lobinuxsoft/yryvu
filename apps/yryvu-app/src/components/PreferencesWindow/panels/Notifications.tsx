// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, type JSX } from "solid-js";

import type { NotificationsPreferences } from "../../../ipc";
import { preferences, updatePreferences } from "../../../state/preferences";

/// yryvu deviation from GK (GK exposes only Desktop + Marketing toggles
/// which don't map here). Order chosen to mirror the typical commit flow
/// rather than the field declaration order in the Rust struct.
const ROWS: ReadonlyArray<{
  field: keyof NotificationsPreferences;
  label: string;
  hint: string;
}> = [
  {
    field: "commitNotifications",
    label: "Commits",
    hint: "Commit, amend, and revert results.",
  },
  {
    field: "branchNotifications",
    label: "Branch operations",
    hint: "Create, rename, delete, and checkout.",
  },
  {
    field: "remoteSyncNotifications",
    label: "Remote sync",
    hint: "Fetch, pull, and push results.",
  },
  {
    field: "stashNotifications",
    label: "Stash",
    hint: "Stash, apply, pop, and drop.",
  },
  {
    field: "repoObjectNotifications",
    label: "Repository objects",
    hint: "Tags, refs, and submodule changes.",
  },
  {
    field: "undoRedoNotifications",
    label: "Undo / redo",
    hint: "Operation rollbacks.",
  },
];

/**
 * Notifications preferences panel — six category toggles gating the
 * `notify.*` API (issue #336, wave 2 of #193). Backend in #333, gating
 * wiring in #335. `loading` severity bypasses gating regardless of these
 * toggles because it carries progress the user explicitly asked for.
 */
export function NotificationsPanel(): JSX.Element {
  const onToggle = (
    field: keyof NotificationsPreferences,
    nextValue: boolean,
  ) => {
    void updatePreferences({ notifications: { [field]: nextValue } });
  };

  const value = (field: keyof NotificationsPreferences): boolean => {
    const prefs = preferences();
    return prefs ? prefs.notifications[field] : true;
  };

  const ready = () => preferences() !== undefined;

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Categories</h3>
      <p class="ui-panel__helper">
        Mute categories you'd rather not see toasted. Errors and progress
        spinners always come through — those carry signal you explicitly
        asked for.
      </p>

      <div class="notifications-panel__rows">
        <For each={ROWS}>
          {(row) => (
            <label class="notifications-panel__row">
              <input
                type="checkbox"
                class="notifications-panel__toggle"
                checked={value(row.field)}
                disabled={!ready()}
                onChange={(e) => onToggle(row.field, e.currentTarget.checked)}
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
