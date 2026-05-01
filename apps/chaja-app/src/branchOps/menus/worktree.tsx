// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  worktreeLock,
  worktreeRemove,
  worktreeUnlock,
  type WorktreeInfo,
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
 * Right-click menu for a worktree row in the LeftPanel WORKTREES
 * section (#225). Shape mirrors GitKraken's `popupWorktreeMenu`
 * (audit doc 10):
 *
 *   Switch to worktree     — same as left-click on the row.
 *   Create branch here     — open the create-branch dialog seeded
 *                            with the worktree's HEAD sha.
 *   ─────
 *   Lock / Unlock          — toggles based on current locked state.
 *                            Hidden for the main worktree (can't lock).
 *   Move…                  — disabled (libgit2 doesn't expose it).
 *   ─────
 *   Remove                 — danger. Hidden for the main worktree.
 */
export function openWorktreeContextMenu(
  deps: MenuDeps,
  e: MouseEvent,
  info: WorktreeInfo,
) {
  e.preventDefault();
  const path = repoPath();
  if (!path) return;

  const items: ContextMenuItem[] = [
    {
      label: "Switch to worktree",
      disabled: !!info.locked && info.locked !== "",
      onSelect: () => {
        setRepoPath(info.workdir);
        void openRepoInAnotherTab(info.workdir, !info.is_main);
      },
    },
  ];
  if (info.head) {
    items.push({
      label: "Create branch here",
      onSelect: () => deps.openCreateDialog(info.head ?? undefined),
    });
  }

  if (!info.is_main) {
    items.push({ type: "separator" });
    const isLocked = !!info.locked;
    items.push({
      label: isLocked ? "Unlock" : "Lock…",
      onSelect: async () => {
        try {
          if (isLocked) {
            await worktreeUnlock(path, info.workdir);
            notify.success("Worktree unlocked", {
              message: info.workdir,
            });
          } else {
            // chajá doesn't ship a Lock-with-reason dialog yet; a
            // null reason matches `git worktree lock` defaults.
            await worktreeLock(path, info.workdir, null);
            notify.success("Worktree locked", { message: info.workdir });
          }
          refreshBranches();
        } catch (err) {
          notify.error(isLocked ? "Unlock failed" : "Lock failed", {
            message: String(err),
          });
        }
      },
    });
    items.push({
      label: "Move…",
      disabled: true,
      // libgit2 doesn't expose `git worktree move`. Hand-rolling the
      // rename + gitdir rewrite is out of scope here — surfaces as
      // disabled with a tooltip pointing the user at the gap.
      onSelect: () => {},
    });
    items.push({ type: "separator" });
    items.push({
      label: "Remove",
      danger: true,
      onSelect: async () => {
        try {
          await worktreeRemove(path, info.workdir);
          refreshBranches();
          refreshWorkingTree();
          notify.info("Worktree removed", { message: info.workdir });
        } catch (err) {
          notify.error("Remove failed", { message: String(err) });
        }
      },
    });
  }

  deps.setMenu({ x: e.clientX, y: e.clientY, items });
}
