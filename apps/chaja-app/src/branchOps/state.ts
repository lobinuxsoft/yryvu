// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import type { MergeStrategy } from "../ipc";
import type { DialogState, MenuState } from "../components/LeftSidebar/types";

/**
 * Reactive surface backing the branch ops factory. Pulled out of
 * `createBranchOps` so dialog openers / menu builders / async handlers
 * can each receive only the slice they actually use, instead of one
 * giant closure capturing everything.
 *
 * `closeDialog` lives here because it touches several signals at once
 * (dialog + dialogError + dialogPathInput) — keeping it next to the
 * setters they wrap avoids a third file just for one helper.
 */
export function createBranchOpsState() {
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [dialog, setDialog] = createSignal<DialogState>(null);
  const [dialogError, setDialogError] = createSignal<string | null>(null);
  const [dialogNameInput, setDialogNameInput] = createSignal("");
  /// Secondary text input shared by multi-field dialogs (currently only
  /// the Add Submodule dialog: name = URL, path = target dir). Kept on
  /// the ops surface so dialog components stay stateless wrappers.
  const [dialogPathInput, setDialogPathInput] = createSignal("");
  const [mergeStrategy, setMergeStrategy] =
    createSignal<MergeStrategy>("fast-forward-or-merge");
  const [refreshingRemote, setRefreshingRemote] = createSignal(false);

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
    setDialogPathInput("");
  }

  return {
    menu,
    setMenu,
    dialog,
    setDialog,
    dialogError,
    setDialogError,
    dialogNameInput,
    setDialogNameInput,
    dialogPathInput,
    setDialogPathInput,
    mergeStrategy,
    setMergeStrategy,
    refreshingRemote,
    setRefreshingRemote,
    closeDialog,
  };
}

export type BranchOpsState = ReturnType<typeof createBranchOpsState>;
