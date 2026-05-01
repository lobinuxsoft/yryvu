// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BranchInfo } from "../../ipc";
import type { ContextMenuItem } from "../../components/ContextMenu";
import { parseRemoteBranchName } from "../../components/LeftSidebar/helpers";
import type { MenuDeps } from "./types";

export function openRemoteContextMenu(
  deps: MenuDeps,
  e: MouseEvent,
  b: BranchInfo,
) {
  e.preventDefault();
  const parsed = parseRemoteBranchName(b.name);
  const items: ContextMenuItem[] = [
    {
      label: `Merge '${b.name}' into current`,
      onSelect: () => deps.openMergePickDialog(b.name),
    },
    { type: "separator" },
    {
      label: "Create branch here",
      onSelect: () => deps.openCreateDialog(b.tip_sha),
    },
    {
      label: `Delete remote '${b.name}'…`,
      danger: true,
      disabled: !parsed,
      onSelect: () =>
        parsed && deps.openDeleteRemoteDialog(parsed.remote, parsed.name),
    },
  ];
  deps.setMenu({ x: e.clientX, y: e.clientY, items });
}
