// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Stash-node context menu items for the commit graph (issue #172).
 *
 * Lives apart from `useCommitOps.ts` because the regular commit menu
 * already pushes that file near the 400-LoC cap; the stash menu has
 * its own action set and is cleanly extractable.
 *
 * The shared sidebar menu builder (`branchOps/menus/stash.tsx`) was
 * not reused here: it accepts a heavier `MenuDeps` surface tied to
 * the LeftSidebar's dialog stack, which CommitGraph doesn't carry
 * (and threading those deps through just for this branch would invert
 * the cost). The four-action menu shape is intentionally identical
 * so users see the same verbs in both surfaces.
 */

import { stashApply, stashDrop, stashPopAt, type StashInfo } from "../../ipc";
import { refreshBranches, refreshGraph, refreshWorkingTree, repoPath } from "../../state";
import type { ContextMenuItem } from "../ContextMenu";
import { notify } from "../Notifications";

export function buildStashMenuItems(
  info: StashInfo,
  index: number,
  sha: string,
  copySha: (sha: string) => void,
): ContextMenuItem[] {
  const label = info.message.split("\n")[0] || `stash@{${index}}`;
  return [
    {
      label: "Apply stash",
      onSelect: async () => {
        const path = repoPath();
        if (!path) return;
        try {
          await stashApply(path, index);
          refreshWorkingTree();
          refreshBranches();
          refreshGraph();
          notify.success("Stash applied", { message: label, category: "stash" });
        } catch (err) {
          notify.error("Apply failed", { message: String(err), category: "stash" });
        }
      },
    },
    {
      label: "Pop stash",
      onSelect: async () => {
        const path = repoPath();
        if (!path) return;
        try {
          await stashPopAt(path, index);
          refreshWorkingTree();
          refreshBranches();
          refreshGraph();
          notify.success("Stash popped", { message: label, category: "stash" });
        } catch (err) {
          notify.error("Pop failed", { message: String(err), category: "stash" });
        }
      },
    },
    {
      label: "Drop stash…",
      danger: true,
      onSelect: () => {
        const ok = window.confirm(
          `Drop ${label}?\n\n` +
            `This removes the stash from the queue. The stash sha stays in ` +
            `the git objects database until garbage collection (~90 days), ` +
            `so you can recover it from a terminal — but it's gone from ` +
            `yryvu's UI.`,
        );
        if (!ok) return;
        void (async () => {
          const path = repoPath();
          if (!path) return;
          try {
            await stashDrop(path, index);
            refreshWorkingTree();
            refreshBranches();
            refreshGraph();
            notify.info("Stash dropped", { message: label, category: "stash" });
          } catch (err) {
            notify.error("Drop failed", { message: String(err), category: "stash" });
          }
        })();
      },
    },
    { type: "separator" },
    {
      label: "Copy commit SHA",
      onSelect: () => copySha(sha),
    },
  ];
}
