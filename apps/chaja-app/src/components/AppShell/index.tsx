// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, onCleanup, onMount, Show } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { CommitGraph } from "../CommitGraph";
import { GraphColumnHeaders } from "../CommitGraph/GraphColumnHeaders";
import { ColdStart } from "../ColdStart";
import { FileDiffTab } from "../FileDiffTab";
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
import { IconOpenFolder, IconStar } from "../Icons";
import { TabBar } from "../TabBar";
import { BranchOpsProvider, createBranchOps } from "../../branchOps";
import {
  mainView,
  pushRecentRepo,
  refreshBranches,
  repoPath,
  setRepoPath,
  setShowLeftPanel,
  setShowRightPanel,
  setShowTerminalPanel,
  showLeftPanel,
  showRightPanel,
  theme,
} from "../../state";
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
    unlisteners.push(await listen("menu:toggle-right-panel", () => setShowRightPanel((v) => !v)));
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

  // Apply the persisted theme to <html data-theme="…"> whenever it changes.
  createEffect(() => {
    document.documentElement.setAttribute("data-theme", theme());
  });

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

  return (
    <BranchOpsProvider ops={branchOps}>
    <div
      class="shell"
      data-show-left={showLeftPanel() ? "true" : "false"}
      data-show-right={showRightPanel() ? "true" : "false"}
    >
      <div class="shell__tabs tabs">
        <div class="tabs__leading">
          <button
            class="tabs__leading-btn"
            classList={{
              "is-active": currentTabType() === "REPO_MANAGEMENT",
            }}
            type="button"
            title="Repo Management"
            aria-label="Repo Management"
            aria-pressed={currentTabType() === "REPO_MANAGEMENT"}
            onClick={() => void openRepoManagementTab()}
          >
            <IconOpenFolder />
          </button>
          <button class="tabs__leading-btn" type="button" title="Favorites" disabled>
            <IconStar />
          </button>
        </div>
        <TabBar />
      </div>

      <div class="shell__toolbar">
        <Toolbar onOpenRepo={openRepoPicker} />
      </div>

      <div class="shell__sidebar">
        <LeftSidebar />
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
          <Show when={repoPath()} fallback={<ColdStart />}>
            <Show when={mainView() === "graph"} fallback={<FileDiffTab />}>
              <div class="main">
                <GraphColumnHeaders />
                <div class="main__graph-host">
                  <CommitGraph repoPath={repoPath()!} />
                </div>
              </div>
            </Show>
          </Show>
        </Show>
      </div>

      <div class="shell__inspector">
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
      <PreferencesWindow />
      <ToastContainer />
    </div>
    </BranchOpsProvider>
  );
}


