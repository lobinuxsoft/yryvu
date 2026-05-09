// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BranchInfo } from "../../ipc";
import { getRemoteUrl } from "../../ipc";
import type { ContextMenuItem } from "../../components/ContextMenu";
import { parseRemoteBranchName } from "../../components/LeftSidebar/helpers";
import { repoPath, setInspectorMode, setSelection } from "../../state";
import { notify } from "../../components/Notifications";
import type { MenuDeps } from "./types";

/**
 * Right-click menu for a remote-tracking branch row in the LeftPanel
 * (#222). Mirrors GK's `popupRefMenu` for `BranchType::Remote` per
 * `docs/research/gitkraken-left-panel/10-context-menus.md` line 131:
 *
 *   Checkout (creates tracking branch) / Merge / Rebase / Pull / Reset
 *   / Delete / Compare / Copy URL.
 *
 * Notes on chajá deviations:
 *
 *   - **Pull** operates on HEAD's upstream regardless of which remote
 *     ref the user right-clicked. We surface a tooltip when the
 *     right-clicked ref is not HEAD's upstream so the action's effect
 *     is unambiguous instead of misleading.
 *   - **Reset** is flattened into 3 entries (Soft / Mixed / Hard)
 *     instead of GK's submenu since chajá's ContextMenu doesn't yet
 *     wrap submenus.
 *   - **Copy URL** copies the remote's fetch URL (e.g.
 *     `https://github.com/foo/bar.git` for `origin/feature-x`), not
 *     the branch ref name. The audit doc spec calls for this; the
 *     branch's ref name is covered by the existing `Copy branch name`
 *     pattern on local-branch menus.
 */
export function openRemoteContextMenu(
  deps: MenuDeps,
  e: MouseEvent,
  b: BranchInfo,
) {
  e.preventDefault();
  const parsed = parseRemoteBranchName(b.name);

  // HEAD-upstream check for the Pull entry. We read the fresh branches
  // list via the section-menu source-of-truth getter; while unset (no
  // sidebar mounted yet) the menu silently disables Pull.
  const headBranch = deps.branchSource()?.find((br) => br.is_head);
  const pullsThisRef = headBranch?.upstream === b.name;

  const items: ContextMenuItem[] = [
    {
      label: "Checkout",
      onSelect: () => void deps.tryCheckoutRemoteTracking(b.name),
    },
    {
      label: `Merge '${b.name}' into current`,
      onSelect: () => deps.openMergePickDialog(b.name),
    },
    {
      label: `Rebase current onto '${b.name}'`,
      onSelect: () => void deps.doRebaseCurrentOnto(b.name),
    },
    { type: "separator" },
    {
      label: "Pull",
      disabled: !pullsThisRef,
      title: pullsThisRef
        ? undefined
        : "This remote is not the current branch's upstream",
      onSelect: () => void deps.doPullCurrent(),
    },
    { type: "separator" },
    {
      label: "Create branch here",
      onSelect: () => deps.openCreateDialog(b.tip_sha),
    },
    {
      label: `Reset HEAD to '${b.name}' (Soft)`,
      onSelect: () => void deps.doResetTo(b.tip_sha, "soft"),
    },
    {
      label: `Reset HEAD to '${b.name}' (Mixed)`,
      onSelect: () => void deps.doResetTo(b.tip_sha, "mixed"),
    },
    {
      label: `Reset HEAD to '${b.name}' (Hard)`,
      danger: true,
      onSelect: () => void deps.doResetTo(b.tip_sha, "hard"),
    },
    { type: "separator" },
    {
      label: `Delete remote '${b.name}'…`,
      danger: true,
      disabled: !parsed,
      onSelect: () =>
        parsed && deps.openDeleteRemoteDialog(parsed.remote, parsed.name),
    },
    { type: "separator" },
    {
      label: "Compare against working copy",
      onSelect: () => {
        setSelection([b.tip_sha], true);
        setInspectorMode("details");
      },
    },
    {
      label: "Copy URL",
      disabled: !parsed,
      onSelect: async () => {
        if (!parsed) return;
        const path = repoPath();
        if (!path) return;
        try {
          const url = await getRemoteUrl(path, parsed.remote);
          await navigator.clipboard.writeText(url);
          notify.info("URL copied", { message: url });
        } catch (err) {
          notify.error("Copy URL failed", { message: String(err) });
        }
      },
    },
  ];
  deps.setMenu({ x: e.clientX, y: e.clientY, items });
}
