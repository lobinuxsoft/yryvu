// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RefTag } from "../../ipc";
import type { ContextMenuItem } from "../../components/ContextMenu";
import { parseRemoteBranchName } from "../../components/LeftSidebar/helpers";
import { setHiddenRef } from "../../state";
import { refKey } from "../helpers";
import type { MenuDeps } from "./types";

/**
 * Right-click menu for a ref pill in the BRANCH/TAG column. Items shape
 * follows the GitKraken bundle's `RefContextMenu` (validated 2026-04-25):
 * `RefCheckout`, `RenameRef`, `RefDelete`, `RefPin` (chajá-internal still),
 * `RefHide`. Ref-kind drives availability — tags don't checkout, remote
 * branches don't rename in-place, etc.
 *
 * The pill's commit sha lets us reuse the same `tryCheckout` /
 * `openCreateDialog` flow as the sidebar — no new ops surface needed.
 */
export function openRefContextMenu(
  deps: MenuDeps,
  e: MouseEvent,
  tag: RefTag,
  sha: string,
) {
  e.preventDefault();
  const items: ContextMenuItem[] = [];
  if (tag.kind === "Branch") {
    items.push({
      label: `Checkout '${tag.name}'`,
      onSelect: () => void deps.tryCheckout(tag.name),
    });
    items.push({
      label: `Merge '${tag.name}' into current`,
      onSelect: () => deps.openMergePickDialog(tag.name),
    });
    items.push({ type: "separator" });
    items.push({
      label: "Create branch here",
      onSelect: () => deps.openCreateDialog(sha),
    });
    items.push({
      label: `Rename '${tag.name}'…`,
      onSelect: () => deps.openRenameDialog(tag.name),
    });
    items.push({
      label: `Delete '${tag.name}'…`,
      danger: true,
      onSelect: () => deps.openDeleteDialog(tag.name),
    });
  } else if (tag.kind === "RemoteBranch") {
    const parsed = parseRemoteBranchName(tag.name);
    items.push({
      label: `Merge '${tag.name}' into current`,
      onSelect: () => deps.openMergePickDialog(tag.name),
    });
    items.push({ type: "separator" });
    items.push({
      label: "Create branch here",
      onSelect: () => deps.openCreateDialog(sha),
    });
    items.push({
      label: `Delete remote '${tag.name}'…`,
      danger: true,
      disabled: !parsed,
      onSelect: () =>
        parsed && deps.openDeleteRemoteDialog(parsed.remote, parsed.name),
    });
  } else if (tag.kind === "Tag") {
    items.push({
      label: "Create branch here",
      onSelect: () => deps.openCreateDialog(sha),
    });
  }
  // Hide is offered for every non-active ref (the bundle gates it on
  // `enableShowHideRefsOptions && !hasActive`; the per-pill flag covers the
  // second half — the first is a global setting we don't expose yet).
  if (tag.kind !== "Head") {
    if (items.length > 0) items.push({ type: "separator" });
    items.push({
      label: `Hide '${tag.name}'`,
      onSelect: () => setHiddenRef(refKey(tag), true),
    });
  }
  if (items.length === 0) return;
  deps.setMenu({ x: e.clientX, y: e.clientY, items });
}
