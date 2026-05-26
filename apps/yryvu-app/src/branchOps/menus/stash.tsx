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
          notify.success("Stash applied", { message: label, category: "stash" });
        } catch (err) {
          notify.error("Apply failed", { message: String(err), category: "stash" });
        }
      },
    },
    {
      label: "Pop",
      onSelect: async () => {
        try {
          await stashPopAt(path, index);
          refreshWorkingTree();
          notify.success("Stash popped", { message: label, category: "stash" });
        } catch (err) {
          notify.error("Pop failed", { message: String(err), category: "stash" });
        }
      },
    },
    {
      label: "Drop…",
      danger: true,
      onSelect: () => {
        // Drop is destructive — gate behind a confirm dialog (issue
        // #12 acceptance: "Drop requires confirmation; apply does
        // not"). The dialog is generic enough that we route through
        // `window.confirm` here rather than mount a per-row Dialog;
        // the destructive copy is verbose so the user can't fat-
        // finger their way past it.
        const ok = window.confirm(
          `Drop ${label}?\n\n` +
            `This removes the stash from the queue. The stash sha stays in ` +
            `the git objects database until garbage collection (~90 days), ` +
            `so you can recover it from a terminal — but it's gone from ` +
            `yryvu's UI.`,
        );
        if (!ok) return;
        void (async () => {
          try {
            await stashDrop(path, index);
            refreshWorkingTree();
            notify.info("Stash dropped", { message: label, category: "stash" });
          } catch (err) {
            notify.error("Drop failed", { message: String(err), category: "stash" });
          }
        })();
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
