// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Commit-row context menu items builder.
 *
 * Separated from `useCommitOps.ts` so the hook stays under the 400-LoC
 * production cap. The function is pure modulo its closures — it builds
 * an items array; the hook owns the side-effecting handlers and passes
 * them in. Co-located here with `stashMenuItems.ts` (which builds the
 * stash variant) keeps the menu surface in one place.
 */

import type { ResetMode } from "../../ipc";
import type { ContextMenuItem } from "../ContextMenu";

export interface CommitMenuHandlers {
  tryCheckout: (sha: string, shortSha: string) => void | Promise<void>;
  openCreateBranchDialog: (sha: string, shortSha: string) => void;
  openCreateTagDialog: (sha: string, shortSha: string, annotated: boolean) => void;
  doReset: (sha: string, mode: ResetMode) => void | Promise<void>;
  openResetHardConfirm: (sha: string, shortSha: string) => void;
  openCherryPickOntoDialog: (sha: string) => void;
  doRevert: (sha: string) => void | Promise<void>;
  doFormatPatch: (sha: string) => void | Promise<void>;
  copySha: (sha: string) => void | Promise<void>;
}

export function buildCommitMenuItems(
  sha: string,
  shortSha: string,
  batchSize: number,
  h: CommitMenuHandlers,
): ContextMenuItem[] {
  const cherryLabel =
    batchSize > 0 ? `Cherry-pick ${batchSize} commits onto…` : "Cherry-pick onto…";
  return [
    {
      label: "Checkout this commit",
      onSelect: () => void h.tryCheckout(sha, shortSha),
    },
    { type: "separator" },
    {
      label: "Create branch here…",
      onSelect: () => h.openCreateBranchDialog(sha, shortSha),
    },
    {
      label: "Create tag here…",
      onSelect: () => h.openCreateTagDialog(sha, shortSha, false),
    },
    {
      label: "Create annotated tag here…",
      onSelect: () => h.openCreateTagDialog(sha, shortSha, true),
    },
    { type: "separator" },
    {
      label: "Reset current branch here (soft)",
      onSelect: () => void h.doReset(sha, "soft"),
    },
    {
      label: "Reset current branch here (mixed)",
      onSelect: () => void h.doReset(sha, "mixed"),
    },
    {
      label: "Reset current branch here (hard)…",
      danger: true,
      onSelect: () => h.openResetHardConfirm(sha, shortSha),
    },
    { type: "separator" },
    {
      label: cherryLabel,
      onSelect: () => h.openCherryPickOntoDialog(sha),
    },
    {
      label: "Revert commit",
      onSelect: () => void h.doRevert(sha),
    },
    { type: "separator" },
    {
      label: "Create patch from commit…",
      onSelect: () => void h.doFormatPatch(sha),
    },
    {
      label: "Copy commit SHA",
      onSelect: () => void h.copySha(sha),
    },
  ];
}
