// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ContextMenuItem } from "../../components/ContextMenu";
import { buildSectionMenuItems } from "./section";
import type { MenuDeps } from "./types";

/**
 * Right-click menu for the REMOTE section header (#227, sub-PR 8 of
 * #219). Since #239 each remote renders as a folder row inside the
 * section (GK parity) and carries its own per-remote menu
 * (`remote-folder.tsx`), so the header menu is section-scoped only:
 *
 *   1. `Add remote…`
 *   2. `Fetch all` (no-arg fetch_prune)
 *   3. Section-menu items from `buildSectionMenuItems` (Hide all /
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

  // Section-level affordances live below the remote ops so
  // right-clicking the REMOTE header doesn't lose Hide all / Maximize
  // / visibility — the same items every other section header surfaces.
  const sectionItems = buildSectionMenuItems(deps, "REMOTE");
  if (sectionItems.length > 0) {
    items.push({ type: "separator" });
    for (const item of sectionItems) items.push(item);
  }

  deps.setMenu({ x: e.clientX, y: e.clientY, items });
}
