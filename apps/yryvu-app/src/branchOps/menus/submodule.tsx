// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  submoduleInit,
  submoduleSync,
  submoduleUpdate,
  type SubmoduleInfo,
} from "../../ipc";
import type { ContextMenuItem } from "../../components/ContextMenu";
import {
  refreshBranches,
  refreshWorkingTree,
  repoPath,
  setRepoPath,
} from "../../state";
import { openRepoInAnotherTab } from "../../tabs/ops";
import { notify } from "../../components/Notifications";
import type { MenuDeps } from "./types";

/**
 * Right-click menu for a submodule row in the LeftPanel SUBMODULES
 * section (#226). Shape mirrors GitKraken's `popupSubmoduleMenu`
 * (audit doc 10):
 *
 *   Initialize             — submodule update --init
 *   Update                 — submodule update (already initialized)
 *   Reset                  — disabled. Force-checkout pinned-SHA
 *                            requires more libgit2 surface than gix
 *                            exposes today.
 *   Commit                 — disabled. Open-the-submodule-as-its-own
 *                            tab is the natural path; commit flow
 *                            already lives there.
 *   ─────
 *   Open in tab            — setRepoPath + openRepoInAnotherTab.
 *   Open in file manager   — Tauri opener `open_path`.
 *   Open in terminal       — disabled. Cross-platform terminal
 *                            launcher needs config (xdg-terminal-exec
 *                            on Linux, Terminal.app on macOS, …).
 *   ─────
 *   Copy path              — clipboard.writeText with absolute path.
 */
export function openSubmoduleContextMenu(
  deps: MenuDeps,
  e: MouseEvent,
  info: SubmoduleInfo,
) {
  e.preventDefault();
  const parent = repoPath();
  if (!parent) return;
  const absPath = `${parent}/${info.path}`;
  const isClickable = info.is_initialized && !info.is_deleted;

  const items: ContextMenuItem[] = [
    {
      label: "Initialize",
      disabled: info.is_initialized,
      onSelect: async () => {
        try {
          await submoduleInit(parent, info.name);
          refreshBranches();
          refreshWorkingTree();
          notify.success("Submodule initialized", {
            message: info.name,
            category: "repoObject",
          });
        } catch (err) {
          notify.error("Initialize failed", {
            message: String(err),
            category: "repoObject",
          });
        }
      },
    },
    {
      label: "Update",
      disabled: !info.is_initialized,
      onSelect: async () => {
        try {
          await submoduleUpdate(parent, info.name);
          refreshBranches();
          refreshWorkingTree();
          notify.success("Submodule updated", {
            message: info.name,
            category: "repoObject",
          });
        } catch (err) {
          notify.error("Update failed", {
            message: String(err),
            category: "repoObject",
          });
        }
      },
    },
    {
      label: "Sync",
      disabled: !info.is_initialized,
      onSelect: async () => {
        try {
          await submoduleSync(parent, info.name);
          refreshBranches();
          refreshWorkingTree();
          notify.success("Submodule synced", {
            message: info.name,
            category: "repoObject",
          });
        } catch (err) {
          notify.error("Sync failed", {
            message: String(err),
            category: "repoObject",
          });
        }
      },
    },
    {
      label: "Reset",
      disabled: !info.is_initialized,
      // Force-checkout to parent-pinned discards local work — the
      // dialog warns (harder when the row is dirty) before firing.
      onSelect: () =>
        deps.openSubmoduleResetDialog(info.name, info.is_dirty),
    },
    {
      label: "Commit",
      disabled: true,
      // The natural path is "Open in tab" + use the commit panel
      // there. Keep the menu item so users discover the option,
      // but route them through the inner-repo flow instead of
      // surfacing a half-baked nested commit dialog here.
      onSelect: () => {},
    },
    { type: "separator" },
    {
      label: "Open in tab",
      disabled: !isClickable,
      onSelect: () => {
        setRepoPath(absPath);
        void openRepoInAnotherTab(absPath);
      },
    },
    {
      label: "Open in file manager",
      disabled: !isClickable,
      onSelect: async () => {
        try {
          const { openPath } = await import("@tauri-apps/plugin-opener");
          await openPath(absPath);
        } catch (err) {
          notify.error("Open in file manager failed", {
            message: String(err),
          });
        }
      },
    },
    {
      label: "Open in terminal",
      disabled: true,
      // Cross-platform terminal launching requires per-OS plumbing
      // (xdg-terminal-exec on Linux, `open -a Terminal` on macOS,
      // wt.exe / cmd on Windows) plus a preference for which one to
      // use. Defer to a focused follow-up.
      onSelect: () => {},
    },
    { type: "separator" },
    {
      label: "Copy path",
      onSelect: () => {
        void navigator.clipboard.writeText(absPath);
        notify.info("Path copied", { message: absPath });
      },
    },
    { type: "separator" },
    {
      label: "Deinitialize…",
      disabled: !info.is_initialized,
      // Unregisters + clears the working tree but keeps .gitmodules
      // and the cached gitdir — Initialize undoes it cheaply.
      onSelect: () =>
        deps.openSubmoduleDeinitDialog(info.name, info.path, info.is_dirty),
    },
    {
      label: "Remove submodule…",
      onSelect: () => deps.openSubmoduleRemoveDialog(info.name, info.path),
    },
  ];

  deps.setMenu({ x: e.clientX, y: e.clientY, items });
}
