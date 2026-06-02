// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext, type JSX } from "solid-js";

import type {
  BranchInfo,
  GitflowConfig,
  RefTag,
  StashInfo,
  SubmoduleInfo,
  TagInfo,
  WorktreeInfo,
} from "../ipc";
import type { SectionKey } from "../state";

import { createBranchOpsState } from "./state";
import { createDialogOpeners } from "./dialogs";
import { createHandlers } from "./handlers";
import { openBranchContextMenu } from "./menus/branch";
import { openGitflowMenu } from "./menus/gitflow";
import { openRemoteContextMenu } from "./menus/remote";
import { openRemoteHeaderContextMenu } from "./menus/remote-header";
import { openRefContextMenu } from "./menus/ref";
import { openSectionContextMenu } from "./menus/section";
import { openStashContextMenu } from "./menus/stash";
import { openSubmoduleContextMenu } from "./menus/submodule";
import { openTagContextMenu } from "./menus/tag";
import { openWorktreeContextMenu } from "./menus/worktree";
import { openWorktreeHeaderContextMenu } from "./menus/worktree-header";
import type { MenuDeps } from "./menus/types";

export { refKey } from "./helpers";

export interface BranchOpsDeps {
  refresh: () => void;
}

/**
 * Composes the four sub-modules (state / dialog openers / async
 * handlers / menu builders) into a single `BranchOps` surface used
 * across the app. Splitting let us keep each layer under ~300 LOC; the
 * shape returned here is what `BranchOps = ReturnType<…>` describes,
 * so consumers don't need to learn the internal split.
 *
 * `branchSource` / `tagSource` are wired late by the LeftSidebar in
 * `onMount`. The menu factory reads them via the `MenuDeps` getters so
 * the section menu sees fresh resource snapshots without re-creating
 * the ops surface.
 */
export function createBranchOps(deps: BranchOpsDeps) {
  const state = createBranchOpsState();
  const openers = createDialogOpeners(state);
  const handlers = createHandlers({ state, refresh: deps.refresh });

  /// Live accessors the section / tag context menus read to compute
  /// Hide-all / Show-all enablement and per-remote tag actions. Wired
  /// by the LeftSidebar in onMount via `setBranchSource` /
  /// `setTagSource` / `setRemotesSource` — the resources live there
  /// and we'd lose reactivity if AppShell tried to thread them
  /// through props ahead of mount. While unset (e.g. in unit tests)
  /// the menu silently drops the dependent group.
  let branchSource: (() => BranchInfo[]) | undefined;
  let tagSource: (() => TagInfo[]) | undefined;
  let remotesSource: (() => string[]) | undefined;
  let gitflowConfigSource: (() => GitflowConfig | null) | undefined;
  function setBranchSource(fn: () => BranchInfo[]): void {
    branchSource = fn;
  }
  function setTagSource(fn: () => TagInfo[]): void {
    tagSource = fn;
  }
  function setRemotesSource(fn: () => string[]): void {
    remotesSource = fn;
  }
  function setGitflowConfigSource(fn: () => GitflowConfig | null): void {
    gitflowConfigSource = fn;
  }

  const menuDeps: MenuDeps = {
    setMenu: state.setMenu,
    tryCheckout: handlers.tryCheckout,
    tryCheckoutRemoteTracking: handlers.tryCheckoutRemoteTracking,
    doRebaseCurrentOnto: handlers.doRebaseCurrentOnto,
    doPullCurrent: handlers.doPullCurrent,
    doPushCurrent: handlers.doPushCurrent,
    doResetTo: handlers.doResetTo,
    openMergePickDialog: openers.openMergePickDialog,
    openCreateDialog: openers.openCreateDialog,
    openRenameDialog: openers.openRenameDialog,
    openDeleteDialog: openers.openDeleteDialog,
    openDeleteRemoteDialog: openers.openDeleteRemoteDialog,
    openSubmoduleRemoveDialog: openers.openSubmoduleRemoveDialog,
    openSetUpstreamDialog: openers.openSetUpstreamDialog,
    branchSource: () => branchSource?.(),
    tagSource: () => tagSource?.(),
    remotesSource: () => remotesSource?.(),
    gitflowConfigSource: () => gitflowConfigSource?.() ?? null,
    openWorktreeAddDialog: openers.openWorktreeAddDialog,
    openWorktreeRemoveDialog: openers.openWorktreeRemoveDialog,
    doWorktreePrune: handlers.doWorktreePrune,
    openGitflowStartDialog: openers.openGitflowStartDialog,
    openGitflowFinishDialog: openers.openGitflowFinishDialog,
    openDeleteTagDialog: openers.openDeleteTagDialog,
    openAnnotateTagDialog: openers.openAnnotateTagDialog,
    pushTagTo: handlers.pushTagTo,
    tryCheckoutTagSha: handlers.tryCheckoutTagSha,
    openAddRemoteDialog: openers.openAddRemoteDialog,
    openEditRemoteDialog: openers.openEditRemoteDialog,
    openRemoveRemoteDialog: openers.openRemoveRemoteDialog,
    fetchRemote: handlers.fetchRemote,
    refreshRemote: handlers.refreshRemote,
  };

  return {
    // state
    menu: state.menu,
    setMenu: state.setMenu,
    dialog: state.dialog,
    dialogError: state.dialogError,
    dialogNameInput: state.dialogNameInput,
    setDialogNameInput: state.setDialogNameInput,
    dialogPathInput: state.dialogPathInput,
    setDialogPathInput: state.setDialogPathInput,
    mergeStrategy: state.mergeStrategy,
    setMergeStrategy: state.setMergeStrategy,
    refreshingRemote: state.refreshingRemote,
    gitflowName: state.gitflowName,
    setGitflowName: state.setGitflowName,
    gitflowTagMessage: state.gitflowTagMessage,
    setGitflowTagMessage: state.setGitflowTagMessage,
    gitflowKeepBranch: state.gitflowKeepBranch,
    setGitflowKeepBranch: state.setGitflowKeepBranch,
    gitflowBase: state.gitflowBase,
    setGitflowBase: state.setGitflowBase,
    worktreeCreateBranch: state.worktreeCreateBranch,
    setWorktreeCreateBranch: state.setWorktreeCreateBranch,
    worktreeBase: state.worktreeBase,
    setWorktreeBase: state.setWorktreeBase,

    // dialog openers / closers
    openCreateDialog: openers.openCreateDialog,
    openRenameDialog: openers.openRenameDialog,
    openDeleteDialog: openers.openDeleteDialog,
    openMergePickDialog: openers.openMergePickDialog,
    openDeleteRemoteDialog: openers.openDeleteRemoteDialog,
    openSubmoduleAddDialog: openers.openSubmoduleAddDialog,
    openSubmoduleRemoveDialog: openers.openSubmoduleRemoveDialog,
    openSetUpstreamDialog: openers.openSetUpstreamDialog,
    openDeleteTagDialog: openers.openDeleteTagDialog,
    openAnnotateTagDialog: openers.openAnnotateTagDialog,
    openAddRemoteDialog: openers.openAddRemoteDialog,
    openEditRemoteDialog: openers.openEditRemoteDialog,
    openRemoveRemoteDialog: openers.openRemoveRemoteDialog,
    openGitflowStartDialog: openers.openGitflowStartDialog,
    openGitflowFinishDialog: openers.openGitflowFinishDialog,
    openWorktreeAddDialog: openers.openWorktreeAddDialog,
    openWorktreeRemoveDialog: openers.openWorktreeRemoveDialog,
    closeDialog: state.closeDialog,

    // context menus (bound to local menuDeps)
    openBranchContextMenu: (e: MouseEvent, b: BranchInfo) =>
      openBranchContextMenu(menuDeps, e, b),
    openRemoteContextMenu: (e: MouseEvent, b: BranchInfo) =>
      openRemoteContextMenu(menuDeps, e, b),
    openRemoteHeaderContextMenu: (e: MouseEvent) =>
      openRemoteHeaderContextMenu(menuDeps, e),
    openRefContextMenu: (e: MouseEvent, tag: RefTag, sha: string) =>
      openRefContextMenu(menuDeps, e, tag, sha),
    openSectionContextMenu: (e: MouseEvent, key: SectionKey) =>
      openSectionContextMenu(menuDeps, e, key),
    openStashContextMenu: (e: MouseEvent, info: StashInfo, index: number) =>
      openStashContextMenu(menuDeps, e, info, index),
    openSubmoduleContextMenu: (e: MouseEvent, info: SubmoduleInfo) =>
      openSubmoduleContextMenu(menuDeps, e, info),
    openWorktreeContextMenu: (e: MouseEvent, info: WorktreeInfo) =>
      openWorktreeContextMenu(menuDeps, e, info),
    openWorktreeHeaderContextMenu: (e: MouseEvent) =>
      openWorktreeHeaderContextMenu(menuDeps, e),
    openTagContextMenu: (e: MouseEvent, tag: TagInfo) =>
      openTagContextMenu(menuDeps, e, tag),
    openGitflowMenu: (e: MouseEvent) => openGitflowMenu(menuDeps, e),
    setBranchSource,
    setTagSource,
    setRemotesSource,
    setGitflowConfigSource,

    // async operations
    tryCheckout: handlers.tryCheckout,
    stashAndCheckout: handlers.stashAndCheckout,
    tryCheckoutRemoteTracking: handlers.tryCheckoutRemoteTracking,
    stashAndCheckoutRemoteTracking: handlers.stashAndCheckoutRemoteTracking,
    submitCreate: handlers.submitCreate,
    submitRename: handlers.submitRename,
    submitDelete: handlers.submitDelete,
    submitMerge: handlers.submitMerge,
    submitDeleteRemote: handlers.submitDeleteRemote,
    submitSubmoduleAdd: handlers.submitSubmoduleAdd,
    submitSubmoduleRemove: handlers.submitSubmoduleRemove,
    submitSetUpstream: handlers.submitSetUpstream,
    submitDeleteTag: handlers.submitDeleteTag,
    submitAnnotateTag: handlers.submitAnnotateTag,
    pushTagTo: handlers.pushTagTo,
    doAbortMerge: handlers.doAbortMerge,
    refreshRemote: handlers.refreshRemote,
    fetchRemote: handlers.fetchRemote,
    submitAddRemote: handlers.submitAddRemote,
    submitEditRemote: handlers.submitEditRemote,
    submitRemoveRemote: handlers.submitRemoveRemote,
    submitGitflowStart: handlers.submitGitflowStart,
    submitGitflowFinish: handlers.submitGitflowFinish,
    submitWorktreeAdd: handlers.submitWorktreeAdd,
    submitWorktreeRemove: handlers.submitWorktreeRemove,
    doWorktreePrune: handlers.doWorktreePrune,
  };
}

export type BranchOps = ReturnType<typeof createBranchOps>;

/**
 * Solid context wiring for the lifted `useBranchOps`. AppShell instantiates
 * exactly one `createBranchOps` call and exposes it via the provider; both
 * LeftSidebar and CommitGraph (ref pills) consume the same instance so the
 * dialogs / menu / refresh nonces stay coordinated.
 */
const BranchOpsContext = createContext<BranchOps>();

export function BranchOpsProvider(props: {
  ops: BranchOps;
  children: JSX.Element;
}) {
  return (
    <BranchOpsContext.Provider value={props.ops}>
      {props.children}
    </BranchOpsContext.Provider>
  );
}

export function useBranchOps(): BranchOps {
  const ctx = useContext(BranchOpsContext);
  if (!ctx) {
    throw new Error("useBranchOps must be called inside <BranchOpsProvider>");
  }
  return ctx;
}
