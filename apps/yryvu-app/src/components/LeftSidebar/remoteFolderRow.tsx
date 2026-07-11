// SPDX-License-Identifier: AGPL-3.0-or-later
import { Icon } from "../Icon";

export interface RemoteFolderRowProps {
  remote: string;
  count: number;
  collapsed: boolean;
  onToggle: (remote: string) => void;
  onContextMenu: (e: MouseEvent, remote: string) => void;
}

/**
 * Folder row for one configured remote inside the REMOTE section
 * (#239). Mirrors GK's per-remote `REPO` row (audit doc 03): caret +
 * host icon + remote name + tracking-branch count. Click toggles the
 * body; right-click opens the per-remote menu (Fetch / Edit / Remove /
 * Open in browser) that used to live on the section header.
 */
export function RemoteFolderRow(props: RemoteFolderRowProps) {
  return (
    <div
      class="sidebar__remote-folder"
      data-collapsed={props.collapsed ? "true" : "false"}
      role="button"
      tabindex={0}
      onClick={() => props.onToggle(props.remote)}
      onContextMenu={(e) => props.onContextMenu(e, props.remote)}
    >
      <span class="sidebar__remote-folder-caret">›</span>
      <span class="sidebar__remote-folder-icon">
        <Icon name="cloud" />
      </span>
      <span class="sidebar__branch-name">{props.remote}</span>
      <span class="sidebar__remote-folder-count">{props.count}</span>
    </div>
  );
}
