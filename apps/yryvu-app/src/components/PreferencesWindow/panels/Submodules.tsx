// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal, Show, type JSX } from "solid-js";

import {
  getSubmoduleAutoUpdate,
  setSubmoduleAutoUpdate,
  type SubmoduleAutoUpdateSetting,
} from "../../../ipc";
import { repoPath } from "../../../state";
import { preferences, updatePreferences } from "../../../state/preferences";
import { notify } from "../../Notifications";

/**
 * Submodules preferences panel (#98). GK parity, bundle-verified
 * (`Submodules-AutoUpdate*` strings + live GK Desktop screenshot):
 * one control — "Keep submodules up to date" tri-state per repo
 * (Use global setting / Enabled for this repo / Disabled for this
 * repo), resolved against a global default on checkout / merge /
 * pull (`maybeAutoUpdateSubmodules` post-op hook).
 *
 * yryvu deviations, documented:
 * - GK keeps the global default on the profile (General surface);
 *   yryvu shows it here as a checkbox — one panel, both knobs.
 * - GK hides the tab when the open repo has no submodules
 *   (`getHasSubmodules` gate); yryvu keeps it visible — the setting
 *   is harmless without submodules (the hook no-ops on a missing
 *   .gitmodules) and pre-configuring is legitimate.
 */
export function SubmodulesPanel(): JSX.Element {
  const [settingNonce, setSettingNonce] = createSignal(0);

  // Per-repo tri-state, re-fetched on repo switch and after writes.
  const [repoSetting] = createResource<
    SubmoduleAutoUpdateSetting | null,
    [string, number]
  >(
    () => [repoPath() ?? "", settingNonce()] as [string, number],
    async ([path]) => {
      if (!path) return null;
      return await getSubmoduleAutoUpdate(path);
    },
    { initialValue: null },
  );

  const ready = () => preferences() !== undefined;
  const globalEnabled = () =>
    preferences()?.submodules.autoUpdateDefault ?? true;

  const persistGlobal = (enabled: boolean) => {
    if (!ready()) return;
    void updatePreferences({ submodules: { autoUpdateDefault: enabled } });
  };

  async function persistRepoSetting(value: SubmoduleAutoUpdateSetting) {
    const path = repoPath();
    if (!path) return;
    try {
      await setSubmoduleAutoUpdate(path, value);
      setSettingNonce((n) => n + 1);
    } catch (e) {
      notify.error("Could not save the submodule setting", {
        message: String(e),
        category: "repoObject",
      });
    }
  }

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Keep submodules up to date</h3>
      <p class="ui-panel__helper">
        Automatically update all submodules after performing a Git action
        (checkout, merge, pull).
      </p>

      <div class="notifications-panel__rows">
        <label class="notifications-panel__row">
          <input
            type="checkbox"
            class="notifications-panel__toggle"
            checked={globalEnabled()}
            disabled={!ready()}
            onChange={(e) => persistGlobal(e.currentTarget.checked)}
          />
          <span class="notifications-panel__label">
            <span class="notifications-panel__label-text">
              Enabled by default
            </span>
            <span class="notifications-panel__hint">
              Global setting — repos can override it below.
            </span>
          </span>
        </label>
      </div>

      <h3 class="preferences__section-title gpg-panel__sub-heading">
        This repo
      </h3>
      <Show
        when={repoPath()}
        fallback={
          <p class="ui-panel__helper">
            <em>Open a repo to set a per-repo override.</em>
          </p>
        }
      >
        <div class="tools-panel__field">
          <label class="ui-panel__label" for="submodules-auto-update">
            Keep submodules up to date
          </label>
          <select
            id="submodules-auto-update"
            class="tools-panel__input"
            value={repoSetting() ?? "default"}
            disabled={repoSetting.loading}
            onChange={(e) =>
              void persistRepoSetting(
                e.currentTarget.value as SubmoduleAutoUpdateSetting,
              )
            }
          >
            <option value="default">
              {`Use global setting (${globalEnabled() ? "Enabled" : "Disabled"})`}
            </option>
            <option value="enabled">Enabled for this repo</option>
            <option value="disabled">Disabled for this repo</option>
          </select>
        </div>
      </Show>
    </div>
  );
}
