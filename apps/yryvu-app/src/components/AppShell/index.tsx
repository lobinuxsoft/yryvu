// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { About } from "../About";
import { CommitGraph } from "../CommitGraph";
import { GraphColumnHeaders } from "../CommitGraph/GraphColumnHeaders";
import { NewTabBody } from "../NewTabBody";
import { CreateIssueDialog } from "../CreateIssueDialog";
import { CreatePrDialog } from "../CreatePrDialog";
import { CommandPalette } from "../CommandPalette";
import { openCommandPalette } from "../CommandPalette/state";
import { ConflictResolverDialog } from "../ConflictResolverDialog";
import { RebaseInteractiveDialog } from "../RebaseInteractiveDialog";
import { FileDiffTab } from "../FileDiffTab";
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
  pushRecentRepo,
  refreshBranches,
  repoPath,
  selectedCommit,
  setRepoPath,
  setShowLeftPanel,
  setShowTerminalPanel,
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
  toggleDetailPanelOpen,
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
import { matchTabKeybind, runTabKeybind } from "../../tabs/keybinds";
import {
  handleCloseTabShortcut,
  openNewTab,
  openReleaseNotes,
  openRepoInAnotherTab,
  openRepoManagementTab,
} from "../../tabs/ops";
import {
  currentTab,
  currentTabType,
  hydrateTabsFromPreferences,
  tabs,
} from "../../tabs/state";
import { runRedo, runUndo } from "../../undoOps";

/// True when the keyboard event target is a text-editing element. The
/// global Ctrl/Cmd+Z listener bails on those so the user's typing-level
/// undo (browser default) survives intact.
function isInsideEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  return target.isContentEditable;
}

async function openRepoPicker() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open a Git repository",
  });
  if (typeof selected === "string") {
    pushRecentRepo(selected);
    setRepoPath(selected);
    // Also create or switch to a REPO tab for the picked path. The ops
    // layer dedupes via switchToRepoTabIfItExists so picking a path
    // that's already open just switches to its existing tab.
    void openRepoInAnotherTab(selected);
  }
}

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

    unlisteners.push(await listen("menu:open-repo", () => void openRepoPicker()));
    unlisteners.push(await listen("menu:toggle-left-panel", () => setShowLeftPanel((v) => !v)));
    unlisteners.push(await listen("menu:toggle-right-panel", () => toggleDetailPanelOpen()));
    unlisteners.push(await listen("menu:toggle-terminal", () => setShowTerminalPanel((v) => !v)));
    // Tab keybinds that GTK/WebKit2GTK reserves at the WebView level
    // (Cmd/Ctrl+T, Cmd/Ctrl+W) come through the native Tauri menu —
    // accelerators on menu items capture before GTK gets to it. The
    // remaining tab keybinds (Tab/Shift+Tab/1-9/Shift+T) live in the
    // window keydown listener since GTK doesn't reserve those.
    unlisteners.push(await listen("menu:new-tab", () => void openNewTab()));
    unlisteners.push(await listen("menu:close-tab", () => void handleCloseTabShortcut()));
    // Help → Release Notes — captures the current app version at click
    // time, matching GK at bundle:2614 (the version is captured at tab
    // create time so an in-place GK auto-update doesn't drift the open
    // tab). Tauri's `getVersion()` reads from tauri.conf.json.
    unlisteners.push(
      await listen("menu:release-notes", async () => {
        const version = await getVersion();
        void openReleaseNotes(version);
      }),
    );
    unlisteners.push(
      await listen("menu:repo-management", () => void openRepoManagementTab()),
    );

    // Global Undo / Redo keyboard shortcuts (issue #187, sub-PR 3 of
    // #130). Skip when focus is inside an editable element so the user
    // can still Ctrl+Z inside the commit message editor and dialog
    // inputs without triggering a repo-level undo. Tauri abstracts the
    // platform — `metaKey || ctrlKey` covers Cmd on macOS and Ctrl on
    // Linux / Windows. `Ctrl+Y` is also accepted as a Windows-style
    // Redo alias.
    const onKeyDown = (e: KeyboardEvent) => {
      if (isInsideEditable(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      // Command palette (issue #14): Ctrl/Cmd+P. Cmd+K used to also
      // open the palette, but GK binds it to the inspector toggle
      // (audit doc 01-panel-chrome.md → `RightPanel.toggleDetailPanel`)
      // and that's the user-visible expectation when porting from GK.
      if (key === "p") {
        e.preventDefault();
        openCommandPalette();
        return;
      }
      if (key === "k") {
        e.preventDefault();
        toggleDetailPanelOpen();
        return;
      }

      // Undo / Redo (issue #187, #130 cluster).
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        void runUndo();
        return;
      }
      if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        void runRedo();
        return;
      }

      // Tab keybinds (issue #207, #135 cluster). Matcher is pure — see
      // tabs/keybinds.ts for the full table + cross-app default rationale.
      const tabIntent = matchTabKeybind({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
      });
      if (tabIntent) {
        e.preventDefault();
        void runTabKeybind(tabIntent);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
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
      <About />
      <ToastContainer />
    </div>
    </BranchOpsProvider>
  );
}


