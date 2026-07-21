// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ContextMenuItem } from "../../components/ContextMenu";
import { getRemoteUrl, listRemotesDetailed } from "../../ipc";
import { repoPath } from "../../state";
import { notify } from "../../components/Notifications";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MenuDeps } from "./types";

/**
 * Best-effort conversion of a git remote URL to a browseable HTTPS URL.
 * Handles the two common shapes:
 *
 *   - `git@host:user/repo.git`   → `https://host/user/repo`
 *   - `https://host/user/repo.git` → `https://host/user/repo`
 *
 * Anything else (`ssh://…`, custom protocols, file paths) is rejected
 * so the menu disables `Open in browser` rather than launching a
 * useless URL handler.
 */
export function browseUrlFor(remoteUrl: string): string | null {
  const stripGit = (s: string) => (s.endsWith(".git") ? s.slice(0, -4) : s);
  if (remoteUrl.startsWith("https://") || remoteUrl.startsWith("http://")) {
    return stripGit(remoteUrl);
  }
  // SCP-like git syntax: user@host:path
  const scp = /^[^@]+@([^:]+):(.+)$/.exec(remoteUrl);
  if (scp) {
    const host = scp[1];
    const path = stripGit(scp[2]);
    return `https://${host}/${path}`;
  }
  return null;
}

/// The four remote-as-entity actions (Fetch / Edit / Remove / Open in
/// browser). Shared shape between the folder-row menu and any future
/// surface that manages a single remote.
export function buildRemoteEntityItems(
  deps: MenuDeps,
  remote: string,
): ContextMenuItem[] {
  return [
    {
      label: `Fetch from '${remote}'`,
      onSelect: () => void deps.fetchRemote(remote),
    },
    {
      label: `Edit '${remote}'…`,
      onSelect: async () => {
        const path = repoPath();
        if (!path) return;
        try {
          // The dialog edits name / fetch / push together, so it needs
          // the whole record — a lone fetch URL can't tell it whether
          // `pushurl` is set.
          const info = (await listRemotesDetailed(path)).find(
            (r) => r.name === remote,
          );
          if (!info) {
            notify.error(`Edit ${remote} failed`, {
              message: "Remote no longer exists",
              category: "repoObject",
            });
            return;
          }
          deps.openEditRemoteDialog(info);
        } catch (err) {
          notify.error(`Edit ${remote} failed`, {
            message: String(err),
            category: "repoObject",
          });
        }
      },
    },
    {
      label: `Remove '${remote}'…`,
      danger: true,
      onSelect: () => deps.openRemoveRemoteDialog(remote),
    },
    {
      label: `Open '${remote}' in browser`,
      onSelect: async () => {
        const path = repoPath();
        if (!path) return;
        try {
          const url = await getRemoteUrl(path, remote);
          const browse = browseUrlFor(url);
          if (!browse) {
            notify.info("No browseable URL", {
              message: `${remote} has no http(s) URL`,
            });
            return;
          }
          await openUrl(browse);
        } catch (err) {
          notify.error("Open in browser failed", { message: String(err) });
        }
      },
    },
  ];
}

/**
 * Right-click menu for a remote folder row in the REMOTE section
 * (#239). This is the GK `popupRemoteMenu` equivalent — the
 * per-remote block that previously lived on the section header menu
 * (#227 deviation, now resolved) keyed to the row the user actually
 * clicked.
 */
export function openRemoteFolderContextMenu(
  deps: MenuDeps,
  e: MouseEvent,
  remote: string,
) {
  e.preventDefault();
  e.stopPropagation();
  deps.setMenu({
    x: e.clientX,
    y: e.clientY,
    items: buildRemoteEntityItems(deps, remote),
  });
}
