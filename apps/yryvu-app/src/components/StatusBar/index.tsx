// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import { repoPath } from "../../state";
import { preferences, updatePreferences } from "../../state/preferences";
import { DEFAULT_ZOOM, ZOOM_FACTORS } from "../../zoom";
import { IconSearch } from "../Icons";
import { Tooltip } from "../Tooltip";

const ZOOM_FACTORS_DESC = [...ZOOM_FACTORS].reverse();

function onZoomChange(event: Event & { currentTarget: HTMLSelectElement }): void {
  const next = Number.parseFloat(event.currentTarget.value);
  if (!Number.isFinite(next)) return;
  void updatePreferences({ ui: { zoom: next } });
}

export function StatusBar() {
  const zoom = () => preferences()?.ui.zoom ?? DEFAULT_ZOOM;

  return (
    <div class="statusbar">
      <Show when={repoPath()} fallback={<span class="statusbar__segment">No repository open</span>}>
        <Tooltip text={repoPath()!}>
          <span class="statusbar__segment">
            {repoPath()!.split("/").filter(Boolean).pop()}
          </span>
        </Tooltip>
      </Show>

      <div class="statusbar__spacer" />

      <Tooltip text="UI zoom">
      <label class="statusbar__segment statusbar__zoom">
        <IconSearch width={12} height={12} />
        <select
          class="statusbar__zoom-select"
          onChange={onZoomChange}
          disabled={!preferences()}
          aria-label="UI zoom"
        >
          <For each={ZOOM_FACTORS_DESC}>
            {(factor) => (
              <option value={String(factor)} selected={zoom() === factor}>
                {Math.round(factor * 100)}%
              </option>
            )}
          </For>
        </select>
      </label>
      </Tooltip>
      <span class="statusbar__badge-pro">OSS</span>
      <span class="statusbar__segment">v0.1.0</span>
    </div>
  );
}
