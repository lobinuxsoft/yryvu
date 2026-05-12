// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ContextMenuItem } from "../../components/ContextMenu";
import { getRemoteUrl } from "../../ipc";
import { repoPath } from "../../state";
import { notify } from "../../components/Notifications";
import { openUrl } from "@tauri-apps/plugin-opener";
import { buildSectionMenuItems } from "./section";
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

/**
 * Right-click menu for the REMOTE section header (#227, sub-PR 8 of
 * #219). chajá deviation from GK: GK renders each remote as a folder
 * row inside the REMOTE section and binds `popupRemoteMenu` to that
 * row. chajá renders remote-tracking branches flat (no per-remote
 * folder yet), so the remote-management actions live on the section
 * header instead. The menu composes:
 *
 *   1. `Add remote…`
 *   2. `Fetch all` (no-arg fetch_prune)
 *   3. Per-remote block, repeated for each configured remote:
 *      `Fetch from <r>` / `Edit <r>…` / `Remove <r>…` / `Open <r> in
 *      browser` (gated to https / scp-style URLs).
 *   4. Section-menu items from `buildSectionMenuItems` (Hide all /
 *      Maximize / visibility checkboxes) so right-clicking the REMOTE
 *      header doesn't lose the affordances every other section gets.
 */
export function openRemoteHeaderContextMenu(
  deps: MenuDeps,
  e: MouseEvent,
) {
  e.preventDefault();

  const remotes = deps.remotesSource() ?? [];

  const items: ContextMenuItem[] = [
    {
      label: "Add remote…",
      onSelect: () => deps.openAddRemoteDialog(),
    },
    { type: "separator" },
    {
      label: "Fetch all",
      disabled: remotes.length === 0,
      onSelect: () => void deps.refreshRemote(),
    },
  ];

  for (const remote of remotes) {
    items.push({ type: "separator" });
    items.push({
      label: `Fetch from '${remote}'`,
      onSelect: () => void deps.fetchRemote(remote),
    });
    items.push({
      label: `Edit '${remote}'…`,
      onSelect: async () => {
        const path = repoPath();
        if (!path) return;
        try {
          const url = await getRemoteUrl(path, remote);
          deps.openEditRemoteDialog(remote, url);
        } catch (err) {
          notify.error(`Edit ${remote} failed`, {
            message: String(err),
            category: "repoObject",
          });
        }
      },
    });
    items.push({
      label: `Remove '${remote}'…`,
      danger: true,
      onSelect: () => deps.openRemoveRemoteDialog(remote),
    });
    items.push({
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
    });
  }

  // Section-level affordances live below the per-remote block so
  // right-clicking the REMOTE header doesn't lose Hide all / Maximize
  // / visibility — the same items every other section header surfaces.
  const sectionItems = buildSectionMenuItems(deps, "REMOTE");
  if (sectionItems.length > 0) {
    items.push({ type: "separator" });
    for (const item of sectionItems) items.push(item);
  }

  deps.setMenu({ x: e.clientX, y: e.clientY, items });
}
