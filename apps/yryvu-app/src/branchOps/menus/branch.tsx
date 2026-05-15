// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BranchInfo } from "../../ipc";
import type { ContextMenuItem } from "../../components/ContextMenu";
import { setInspectorMode, setSelection } from "../../state";
import { activePrContext } from "../../state/pull-requests";
import { openCreatePrDialog } from "../../components/CreatePrDialog/state";
import { notify } from "../../components/Notifications";
import type { MenuDeps } from "./types";

/**
 * Right-click menu for a local branch row in the LeftPanel
 * (#221). Mirrors GK's `popupRefMenu` → `getRefGroupItems` shape
 * (bundle:232395), trimmed to the surfaces chajá actually wraps:
 *
 *   Checkout / Merge into current / Rebase current onto    — operate
 *                                                            on the
 *                                                            right-clicked
 *                                                            ref.
 *   Pull / Push / Set Upstream                             — operate
 *                                                            on HEAD;
 *                                                            disabled
 *                                                            when the
 *                                                            right-clicked
 *                                                            row isn't
 *                                                            HEAD so the
 *                                                            user has a
 *                                                            single
 *                                                            unambiguous
 *                                                            target.
 *   Push and start PR                                      — disabled,
 *                                                            blocked by
 *                                                            #46 (OAuth).
 *   Create branch here / Reset HEAD here (Soft|Mixed|Hard) — Reset 3-way
 *                                                            flattens GK's
 *                                                            submenu since
 *                                                            chajá's
 *                                                            ContextMenu
 *                                                            doesn't yet
 *                                                            wrap submenus.
 *   Rename / Delete                                        — already
 *                                                            wired before
 *                                                            this PR.
 *   Compare against working copy / Copy branch name        — UI ops; no
 *                                                            backend call.
 *
 * "Pin to left" lives in #233 — it needs graph-lane rendering work
 * beyond a menu item.
 */
export function openBranchContextMenu(
  deps: MenuDeps,
  e: MouseEvent,
  b: BranchInfo,
) {
  e.preventDefault();
  const isHead = b.is_head;
  const hasUpstream = !!b.upstream;
  const headOnly = !isHead;
  const items: ContextMenuItem[] = [
    {
      label: "Checkout",
      disabled: isHead,
      onSelect: () => void deps.tryCheckout(b.name),
    },
    {
      label: `Merge '${b.name}' into current`,
      disabled: isHead,
      onSelect: () => deps.openMergePickDialog(b.name),
    },
    {
      label: `Rebase current onto '${b.name}'`,
      disabled: isHead,
      onSelect: () => void deps.doRebaseCurrentOnto(b.name),
    },
    { type: "separator" },
    {
      label: "Pull",
      disabled: headOnly || !hasUpstream,
      title: headOnly
        ? "Checkout this branch to pull"
        : !hasUpstream
          ? "Branch has no upstream — set one first"
          : undefined,
      onSelect: () => void deps.doPullCurrent(),
    },
    {
      label: "Push",
      disabled: headOnly,
      title: headOnly ? "Checkout this branch to push" : undefined,
      onSelect: () => void deps.doPushCurrent(),
    },
    {
      label: "Set Upstream…",
      disabled: headOnly,
      title: headOnly ? "Checkout this branch to set its upstream" : undefined,
      onSelect: () => deps.openSetUpstreamDialog(b.name, b.upstream),
    },
    {
      label: "Create pull request from this branch…",
      disabled: !activePrContext(),
      title: !activePrContext()
        ? "Connect the repo's hosting integration to enable"
        : undefined,
      onSelect: () => openCreatePrDialog({ prefillHead: b.name }),
    },
    { type: "separator" },
    {
      label: "Create branch here",
      onSelect: () => deps.openCreateDialog(b.tip_sha),
    },
    {
      label: `Reset HEAD to '${b.name}' (Soft)`,
      disabled: isHead,
      onSelect: () => void deps.doResetTo(b.tip_sha, "soft"),
    },
    {
      label: `Reset HEAD to '${b.name}' (Mixed)`,
      disabled: isHead,
      onSelect: () => void deps.doResetTo(b.tip_sha, "mixed"),
    },
    {
      label: `Reset HEAD to '${b.name}' (Hard)`,
      danger: true,
      disabled: isHead,
      onSelect: () => void deps.doResetTo(b.tip_sha, "hard"),
    },
    { type: "separator" },
    {
      label: `Rename '${b.name}'…`,
      onSelect: () => deps.openRenameDialog(b.name),
    },
    {
      label: `Delete '${b.name}'…`,
      danger: true,
      disabled: isHead,
      onSelect: () => deps.openDeleteDialog(b.name),
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
      label: "Copy branch name",
      onSelect: () => {
        void navigator.clipboard.writeText(b.name);
        notify.info("Branch name copied", { message: b.name, category: "branch" });
      },
    },
  ];
  deps.setMenu({ x: e.clientX, y: e.clientY, items });
}
