// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ContextMenuItem } from "../../components/ContextMenu";
import { buildSectionMenuItems } from "./section";
import type { MenuDeps } from "./types";

/**
 * Right-click menu for the WORKTREES section header (#20). Mirrors
 * GitKraken's header affordances: "Create worktree" + "Prune", then the
 * standard section visibility group composed underneath (same pattern
 * as the REMOTE header in #227).
 */
export function openWorktreeHeaderContextMenu(deps: MenuDeps, e: MouseEvent) {
  e.preventDefault();
  const items: ContextMenuItem[] = [
    {
      label: "Create worktree…",
      onSelect: () => deps.openWorktreeAddDialog(),
    },
    {
      label: "Prune worktrees",
      title: "Remove admin entries for worktrees whose directory is gone",
      onSelect: () => void deps.doWorktreePrune(),
    },
    { type: "separator" },
    ...buildSectionMenuItems(deps, "WORKTREES"),
  ];
  deps.setMenu({ x: e.clientX, y: e.clientY, items });
}
