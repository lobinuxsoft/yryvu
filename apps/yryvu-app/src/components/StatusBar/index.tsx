// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { repoPath } from "../../state";

export function StatusBar() {
  return (
    <div class="statusbar">
      <Show when={repoPath()} fallback={<span class="statusbar__segment">No repository open</span>}>
        <span class="statusbar__segment" title={repoPath()!}>
          {repoPath()!.split("/").filter(Boolean).pop()}
        </span>
      </Show>

      <div class="statusbar__spacer" />

      <span class="statusbar__segment">100%</span>
      <span class="statusbar__badge-pro">OSS</span>
      <span class="statusbar__segment">v0.1.0</span>
    </div>
  );
}
