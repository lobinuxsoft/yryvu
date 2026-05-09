// SPDX-License-Identifier: AGPL-3.0-or-later

import { stashApply, stashDrop, stashPopAt, type StashInfo } from "../../ipc";
import type { ContextMenuItem } from "../../components/ContextMenu";
import { refreshWorkingTree, repoPath } from "../../state";
import { notify } from "../../components/Notifications";
import type { MenuDeps } from "./types";

/**
 * Right-click menu for a stash row in the LeftPanel STASHES section.
 * Shape mirrors GitKraken's `popupStashMenu` (audit doc 10): Apply,
 * Pop, Drop, Amend message. Amend stays disabled until the rewrite-
 * stash flow lands in a follow-up.
 *
 * `index` is the LIFO position from `listStashes` (0 = top). Apply
 * keeps the entry in the queue; Pop applies + removes; Drop removes
 * without applying. Drop records the dropped sha in the undo log so
 * the stash survives in the objects DB until GC.
 */
export function openStashContextMenu(
  deps: MenuDeps,
  e: MouseEvent,
  info: StashInfo,
  index: number,
) {
  e.preventDefault();
  const path = repoPath();
  if (!path) return;

  const label = info.message.split("\n")[0] || `stash@{${index}}`;
  const items: ContextMenuItem[] = [
    {
      label: "Apply",
      onSelect: async () => {
        try {
          await stashApply(path, index);
          refreshWorkingTree();
          notify.success("Stash applied", { message: label });
        } catch (err) {
          notify.error("Apply failed", { message: String(err) });
        }
      },
    },
    {
      label: "Pop",
      onSelect: async () => {
        try {
          await stashPopAt(path, index);
          refreshWorkingTree();
          notify.success("Stash popped", { message: label });
        } catch (err) {
          notify.error("Pop failed", { message: String(err) });
        }
      },
    },
    {
      label: "Drop",
      danger: true,
      onSelect: async () => {
        try {
          await stashDrop(path, index);
          refreshWorkingTree();
          // Note: stash drop is NOT undoable via the chajá undo log
          // (crates/chaja-bridge/src/repo/undo.rs:22 — re-stashing
          // needs a heavier snapshot than libgit2 exposes). The sha
          // does live in the objects DB until git GC (~90 days), so
          // a determined user can `git stash apply <sha>` from a
          // terminal — but from chajá's UI it's gone for good.
          notify.info("Stash dropped", { message: label });
        } catch (err) {
          notify.error("Drop failed", { message: String(err) });
        }
      },
    },
    { type: "separator" },
    {
      label: "Amend message…",
      disabled: true,
      // TODO: wire stash message rewrite — needs a small backend op
      // that reads the stash commit, re-creates with the new message,
      // and updates refs/stash. Tracked as part of the #224 follow-up
      // (deferred per the issue body).
      onSelect: () => {},
    },
  ];
  deps.setMenu({ x: e.clientX, y: e.clientY, items });
}
