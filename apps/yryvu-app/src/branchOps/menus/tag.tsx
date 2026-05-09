// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TagInfo } from "../../ipc";
import type { ContextMenuItem } from "../../components/ContextMenu";
import { notify } from "../../components/Notifications";
import type { MenuDeps } from "./types";

/**
 * Right-click menu for a tag row in the LeftPanel TAGS section
 * (#223). Shape mirrors GitKraken's `popupTagMenu` (audit doc 10
 * line 135):
 *
 *   Checkout tag — detached HEAD on the peeled SHA.
 *   ─────
 *   Create branch here — seeds CreateDialog with the tag's tip.
 *   Annotate… — only enabled for lightweight tags.
 *   ─────
 *   Push to <remote> — one entry per configured remote.
 *   ─────
 *   Delete '<name>'… — local delete confirmation.
 *   Delete '<name>' from <remote>… — one entry per remote.
 *   Delete '<name>' from all remotes… — only when there are >1 remotes
 *                                       (subsumed by the per-remote
 *                                       entry when there's only one).
 *   ─────
 *   Copy tag name — clipboard.writeText.
 *   Merge '<name>' into current — opens the merge-pick dialog with
 *                                 the tag name as the source ref.
 *
 * Per-remote entries collapse cleanly when the repo has zero remotes
 * (Push/Delete-from-remote/Delete-from-all groups all skip).
 */
export function openTagContextMenu(
  deps: MenuDeps,
  e: MouseEvent,
  tag: TagInfo,
) {
  e.preventDefault();
  const remotes = deps.remotesSource() ?? [];

  const items: ContextMenuItem[] = [
    {
      label: "Checkout tag",
      onSelect: () => void deps.tryCheckoutTagSha(tag.name, tag.target_sha),
    },
    { type: "separator" },
    {
      label: "Create branch here",
      onSelect: () => deps.openCreateDialog(tag.target_sha),
    },
    {
      label: "Annotate…",
      disabled: tag.is_annotated,
      title: tag.is_annotated
        ? "Tag is already annotated"
        : undefined,
      onSelect: () => deps.openAnnotateTagDialog(tag.name),
    },
  ];

  // Push group. Skip entirely on remote-less repos so the menu
  // doesn't render an empty separator pair.
  if (remotes.length > 0) {
    items.push({ type: "separator" });
    pushRemoteEntries(items, remotes, (remote) => ({
      label: `Push to ${remote}`,
      onSelect: () => void deps.pushTagTo(remote, tag.name),
    }));
  }

  // Delete group: local + per-remote + (when >1) all-remotes.
  items.push({ type: "separator" });
  items.push({
    label: `Delete '${tag.name}'…`,
    danger: true,
    onSelect: () => deps.openDeleteTagDialog(tag.name, { type: "local" }),
  });
  for (const remote of remotes) {
    items.push({
      label: `Delete '${tag.name}' from ${remote}…`,
      danger: true,
      onSelect: () =>
        deps.openDeleteTagDialog(tag.name, { type: "remote", remote }),
    });
  }
  if (remotes.length > 1) {
    items.push({
      label: `Delete '${tag.name}' from all remotes…`,
      danger: true,
      onSelect: () =>
        deps.openDeleteTagDialog(tag.name, {
          type: "all-remotes",
          remotes,
        }),
    });
  }

  items.push({ type: "separator" });
  items.push({
    label: "Copy tag name",
    onSelect: () => {
      void navigator.clipboard.writeText(tag.name);
      notify.info("Tag name copied", { message: tag.name });
    },
  });
  items.push({
    label: `Merge '${tag.name}' into current`,
    onSelect: () => deps.openMergePickDialog(tag.name),
  });

  deps.setMenu({ x: e.clientX, y: e.clientY, items });
}

/**
 * Append one ContextMenuItem per remote — extracted to avoid a typo
 * loop in the push-vs-delete groups (we used to repeat the spread
 * twice with different builders, which made it easy to drift).
 */
function pushRemoteEntries(
  items: ContextMenuItem[],
  remotes: string[],
  build: (remote: string) => ContextMenuItem,
): void {
  for (const remote of remotes) {
    items.push(build(remote));
  }
}

