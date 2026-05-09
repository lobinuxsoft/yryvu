// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { type SubmoduleInfo } from "../../ipc";
import { repoPath, setRepoPath } from "../../state";
import { openRepoInAnotherTab } from "../../tabs/ops";

interface SubmoduleRowProps {
  sub: SubmoduleInfo;
  onContextMenu: (e: MouseEvent, sub: SubmoduleInfo) => void;
}

export function SubmoduleRow(props: SubmoduleRowProps) {
  const sub = () => props.sub;

  const onClick = () => {
    const parent = repoPath();
    if (!parent || !sub().is_initialized || sub().is_deleted) return;
    // Submodule.path is relative to the parent. Build the absolute
    // path before handing it to the tab dispatcher.
    const abs = `${parent}/${sub().path}`;
    setRepoPath(abs);
    void openRepoInAnotherTab(abs);
  };

  const isClickable = () => sub().is_initialized && !sub().is_deleted;

  return (
    <div
      class="sidebar__branch-row sidebar__row--submodule"
      classList={{ "is-disabled": !isClickable() }}
      role="button"
      tabindex={isClickable() ? 0 : -1}
      title={sub().url ?? sub().path}
      onClick={onClick}
      onContextMenu={(e) => props.onContextMenu(e, sub())}
    >
      <span class="sidebar__branch-name">{sub().name}</span>
      <span class="sidebar__row-meta">{sub().path}</span>
      <Show when={!sub().is_initialized}>
        <span
          class="sidebar__row-badge sidebar__row-badge--warn"
          title="Run 'git submodule update --init' to clone"
        >
          uninit
        </span>
      </Show>
      <Show when={sub().is_deleted}>
        <span
          class="sidebar__row-badge sidebar__row-badge--warn"
          title="Submodule directory is missing on disk"
        >
          deleted
        </span>
      </Show>
      <Show when={sub().ahead > 0}>
        <span
          class="sidebar__row-counter"
          title={`${sub().ahead} commits ahead of parent-pinned`}
        >
          ↑{sub().ahead}
        </span>
      </Show>
      <Show when={sub().behind > 0}>
        <span
          class="sidebar__row-counter"
          title={`${sub().behind} commits behind parent-pinned`}
        >
          ↓{sub().behind}
        </span>
      </Show>
    </div>
  );
}
