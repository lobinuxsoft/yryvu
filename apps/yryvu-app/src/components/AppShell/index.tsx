// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { type UnlistenFn } from "@tauri-apps/api/event";

import { About } from "../About";
import { CommitGraph } from "../CommitGraph";
import { GraphColumnHeaders } from "../CommitGraph/GraphColumnHeaders";
import { NewTabBody } from "../NewTabBody";
import { CreateIssueDialog } from "../CreateIssueDialog";
import { CreatePrDialog } from "../CreatePrDialog";
import { CommandPalette } from "../CommandPalette";
import { ConflictResolverDialog } from "../ConflictResolverDialog";
import { RebaseInteractiveDialog } from "../RebaseInteractiveDialog";
import { CommitFilterBar } from "../CommitFilterBar";
import { DropActionMenu } from "../DropActionMenu";
import { StashCreateDialog } from "../StashCreateDialog";
import { UndoDirtyDialog } from "../UndoDirtyDialog";
import { FileDiffTab } from "../FileDiffTab";
import { FileHistoryPanel } from "../FileHistoryPanel";
import { IssueDetailPanel } from "../IssueDetail";
import { PullRequestDetailPanel } from "../PullRequestDetail";
import { Toolbar } from "../Toolbar";
import { LeftSidebar } from "../LeftSidebar";
import { DialogsHost } from "../LeftSidebar/DialogsHost";
import { CloneDialog } from "../Onboarding/CloneDialog";
import { InitDialog } from "../Onboarding/InitDialog";
import { PreferencesWindow } from "../PreferencesWindow";
import { ReleaseNotesBody } from "../ReleaseNotes";
import { RepoManagementBody } from "../RepoManagement";
import { RightPanel } from "../RightPanel";
import { StatusBar } from "../StatusBar";
import { ContextMenu } from "../ContextMenu";
import { ToastContainer } from "../Notifications";
import { CredentialSetupDialog } from "../CredentialSetup/CredentialSetupDialog";
import { SshKeyGenDialog } from "../CredentialSetup/SshKeyGenDialog";
import { hydrateIntegrationsOnAppStart } from "../PreferencesWindow/panels/Integrations/tokenStorage";
import { Tooltip } from "../Tooltip";
import { wireAnimationMode } from "./animationMode";
import { IconOpenFolder, IconStar } from "../Icons";
import { TabBar } from "../TabBar";
import { BranchOpsProvider, createBranchOps } from "../../branchOps";
import {
  dirtyFileCount,
  inspectorMode,
  mainView,
  primeAuthEnv,
  refreshBranches,
  repoPath,
  selectedCommit,
  setRepoPath,
  showLeftPanel,
} from "../../state";
import {
  clampWidth as clampDetailPanelWidth,
  commitDetailPanelLayout,
  detailPanelOpen,
  detailPanelWidth,
  hydrateDetailPanelLayout,
  setDetailPanelOpen,
  setDetailPanelWidth,
} from "../../state/detail-panel-layout";
import {
  clampWidth as clampLeftSidebarWidth,
  commitLeftSidebarLayout,
  hydrateLeftSidebarLayout,
  leftSidebarWidth,
  setLeftSidebarWidth,
} from "../../state/left-sidebar-layout";
import { STORAGE_PREFIX } from "../../state/storage";
import { ResizableEdge } from "../ResizableEdge";
import {
  openNewTab,
  openRepoInAnotherTab,
  openRepoManagementTab,
} from "../../tabs/ops";
import {
  currentTab,
  currentTabType,
  hydrateTabsFromPreferences,
  tabs,
} from "../../tabs/state";
import { handleGlobalKeyDown } from "./globalKeydown";
import { registerMenuListeners } from "./menuListeners";
import { openRepoPicker } from "./repoActions";

export function AppShell() {
  const unlisteners: UnlistenFn[] = [];

  onMount(async () => {
    // Hydrate the tab system store from preferences.json. This must run
    // before anything that reads tabs() / selectedTabId() to avoid an
    // empty-then-replace flicker. After hydration, if the persisted
    // legacy repoPath() points at a repo but no REPO tab exists in the
    // store (e.g. first launch of a chajá build that has tabs), back-
    // fill a REPO tab so the user sees the strip in sync. If both
    // stores are empty, open a NEW tab so the strip isn't blank.
    await hydrateTabsFromPreferences();
    // Hydrate inspector panel width / height / open from preferences.json.
    // Must follow tab hydration so the cached Preferences envelope is
    // populated when this also goes for it (both use getPreferences()
    // — first call wins the network round-trip, others reuse the
    // backend's in-memory copy).
    await hydrateDetailPanelLayout();
    await hydrateLeftSidebarLayout();
    // One-shot migration: the previous boolean lived in localStorage
    // under `yryvu.showRightPanel`. Promote it into the freshly
    // hydrated `layout.detailPanel.open` field and remove the legacy
    // key so the localStorage namespace doesn't keep the stale entry.
    const legacyOpen = localStorage.getItem(`${STORAGE_PREFIX}showRightPanel`);
    if (legacyOpen !== null) {
      setDetailPanelOpen(legacyOpen !== "0");
      localStorage.removeItem(`${STORAGE_PREFIX}showRightPanel`);
    }
    // Hydrate integration connection states from the backend sidecar +
    // keyring so the Clone dialog's per-provider sub-tabs (#374) and
    // the Preferences > Integrations panel see "connected" without
    // waiting for the user to open Preferences first.
    void hydrateIntegrationsOnAppStart();
    // Probe the credential environment once at startup so the setup
    // wizard (#44) can render the detected state without a round-trip on
    // the first push failure.
    void primeAuthEnv();
    // Animation mode wiring (#316). Sets `<html data-animations>`
    // from `preferences().ui.animations`; subscribes to OS
    // `prefers-reduced-motion` live for the `system` policy.
    wireAnimationMode();
    if (tabs().length === 0) {
      const persistedRepo = repoPath();
      if (persistedRepo) {
        await openRepoInAnotherTab(persistedRepo);
      } else {
        await openNewTab();
      }
    }

    unlisteners.push(...(await registerMenuListeners()));

    window.addEventListener("keydown", handleGlobalKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleGlobalKeyDown));
  });

  onCleanup(() => unlisteners.forEach((fn) => fn()));

  // Sync the active tab into the legacy repoPath() signal so the rest of
  // the app (CommitGraph, sidebar, inspector — all built before the tab
  // system) keeps working unchanged. One-way: tabs → repoPath. The other
  // direction is handled at the call sites of setRepoPath (openRepoPicker
  // here, ColdStart, RepoSwitcher) which also fire openRepoInAnotherTab.
  createEffect(() => {
    const t = currentTab();
    const tType = currentTabType();
    if (tType === "REPO_MANAGEMENT") {
      // Permanent tab visible — no repo viewport, leave repoPath as-is.
      return;
    }
    if (t?.type === "REPO" && t.repoPath !== repoPath()) {
      setRepoPath(t.repoPath);
    } else if (t?.type === "NEW" && repoPath() !== undefined) {
      // Switching into a NEW tab clears the repo viewport so the
      // welcome screen can render.
      setRepoPath(undefined);
    } else if (t?.type === "RELEASE_NOTES" && repoPath() !== undefined) {
      setRepoPath(undefined);
    }
  });

  // Single shared BranchOps instance. LeftSidebar and CommitGraph (ref pills)
  // both consume it via `useBranchOps()` so dialogs and the context menu
  // overlay live at the shell level — opening a menu from a ref pill in the
  // graph still surfaces the same dialogs the sidebar uses.
  const branchOps = createBranchOps({ refresh: refreshBranches });

  /// Inspector visibility (audit doc `01-panel-chrome.md`):
  ///   visible = userPrefersOpen && (hasSelectedCommit || inStagingMode)
  /// "No selection → hide panel entirely, not show empty placeholder" —
  /// `data-show-right="false"` collapses the grid cell via shell/grid.css.
  /// The legacy "View Changes" banner (rendered inside RightPanel when
  /// dirty + viewing details) becomes redundant since dirty-tree now
  /// surfaces the panel automatically by appearing in this predicate.
  const inspectorVisible = createMemo(
    () =>
      detailPanelOpen() &&
      (selectedCommit() !== undefined ||
        dirtyFileCount() > 0 ||
        inspectorMode() === "staging"),
  );

  return (
    <BranchOpsProvider ops={branchOps}>
    <div
      class="shell"
      data-show-left={showLeftPanel() ? "true" : "false"}
      data-show-right={inspectorVisible() ? "true" : "false"}
    >
      <div class="shell__tabs tabs">
        <div class="tabs__leading">
          <Tooltip text="Repo Management">
            <button
              class="tabs__leading-btn"
              classList={{
                "is-active": currentTabType() === "REPO_MANAGEMENT",
              }}
              type="button"
              aria-label="Repo Management"
              aria-pressed={currentTabType() === "REPO_MANAGEMENT"}
              onClick={() => void openRepoManagementTab()}
            >
              <IconOpenFolder />
            </button>
          </Tooltip>
          <Tooltip text="Favorites">
            <button class="tabs__leading-btn" type="button" disabled>
              <IconStar />
            </button>
          </Tooltip>
        </div>
        <TabBar />
      </div>

      <div class="shell__toolbar">
        <Toolbar onOpenRepo={openRepoPicker} />
      </div>

      <div
        class="shell__sidebar"
        style={{ width: `${leftSidebarWidth()}px` }}
      >
        <LeftSidebar />
        <ResizableEdge
          edge="right"
          width={leftSidebarWidth}
          setWidth={setLeftSidebarWidth}
          clamp={clampLeftSidebarWidth}
          viewportMaxWidth={() => {
            // Reserve enough viewport for the main area + the right
            // inspector (when shown) so the sidebar can't push them
            // off-screen. 480px main floor matches the right-edge
            // reservation used by the inspector drag.
            const inner =
              typeof window !== "undefined" ? window.innerWidth : 1280;
            return Math.max(0, inner - detailPanelWidth() - 480);
          }}
          commit={commitLeftSidebarLayout}
          ariaLabel="Resize left sidebar"
        />
      </div>

      <div class="shell__main">
        <Show when={currentTabType() === "RELEASE_NOTES"}>
          <ReleaseNotesBody
            version={
              currentTab()?.type === "RELEASE_NOTES"
                ? (currentTab() as { version: string }).version
                : ""
            }
          />
        </Show>
        <Show when={currentTabType() === "REPO_MANAGEMENT"}>
          <RepoManagementBody />
        </Show>
        <Show
          when={
            currentTabType() !== "RELEASE_NOTES" &&
            currentTabType() !== "REPO_MANAGEMENT"
          }
        >
          <Show when={repoPath()} fallback={<NewTabBody />}>
            <Switch
              fallback={
                <div class="main">
                  <CommitFilterBar />
                  <GraphColumnHeaders />
                  <div class="main__graph-host">
                    <CommitGraph repoPath={repoPath()!} />
                  </div>
                </div>
              }
            >
              <Match when={mainView() === "diff"}>
                <FileDiffTab />
              </Match>
              <Match when={mainView() === "prDetail"}>
                <PullRequestDetailPanel />
              </Match>
              <Match when={mainView() === "issueDetail"}>
                <IssueDetailPanel />
              </Match>
              <Match when={mainView() === "fileHistory"}>
                <FileHistoryPanel />
              </Match>
            </Switch>
          </Show>
        </Show>
      </div>

      <div
        class="shell__inspector"
        style={{ width: `${detailPanelWidth()}px` }}
      >
        <ResizableEdge
          edge="left"
          width={detailPanelWidth}
          setWidth={setDetailPanelWidth}
          clamp={clampDetailPanelWidth}
          viewportMaxWidth={() => {
            const inner =
              typeof window !== "undefined" ? window.innerWidth : 1280;
            return Math.max(0, inner - leftSidebarWidth() - 480);
          }}
          commit={commitDetailPanelLayout}
          ariaLabel="Resize inspector panel"
        />
        <RightPanel />
      </div>

      <div class="shell__statusbar">
        <StatusBar />
      </div>

      <Show when={branchOps.menu()}>
        <ContextMenu
          x={branchOps.menu()!.x}
          y={branchOps.menu()!.y}
          items={branchOps.menu()!.items}
          onClose={() => branchOps.setMenu(null)}
        />
      </Show>
      <DialogsHost ops={branchOps} />
      <InitDialog />
      <CloneDialog />
      <CreateIssueDialog />
      <CreatePrDialog />
      <RebaseInteractiveDialog />
      <ConflictResolverDialog />
      <CommandPalette />
      <PreferencesWindow />
      <DropActionMenu />
      <StashCreateDialog />
      <UndoDirtyDialog />
      <CredentialSetupDialog />
      <SshKeyGenDialog />
      <About />
      <ToastContainer />
    </div>
    </BranchOpsProvider>
  );
}


