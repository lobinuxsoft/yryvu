// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, onCleanup, onMount, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { CommitGraph } from "../CommitGraph";
import { ColdStart } from "../ColdStart";
import { FileDiffTab } from "../FileDiffTab";
import { Toolbar } from "../Toolbar";
import { LeftSidebar } from "../LeftSidebar";
import { RightPanel } from "../RightPanel";
import { StatusBar } from "../StatusBar";
import { IconOpenFolder, IconPlus, IconStar } from "../Icons";
import {
  mainView,
  pushRecentRepo,
  repoPath,
  setRepoPath,
  setShowLeftPanel,
  setShowRightPanel,
  setShowTerminalPanel,
  showLeftPanel,
  showRightPanel,
  theme,
} from "../../state";

async function openRepoPicker() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open a Git repository",
  });
  if (typeof selected === "string") {
    pushRecentRepo(selected);
    setRepoPath(selected);
  }
}

export function AppShell() {
  const unlisteners: UnlistenFn[] = [];

  onMount(async () => {
    unlisteners.push(await listen("menu:open-repo", () => void openRepoPicker()));
    unlisteners.push(await listen("menu:toggle-left-panel", () => setShowLeftPanel((v) => !v)));
    unlisteners.push(await listen("menu:toggle-right-panel", () => setShowRightPanel((v) => !v)));
    unlisteners.push(await listen("menu:toggle-terminal", () => setShowTerminalPanel((v) => !v)));
  });

  onCleanup(() => unlisteners.forEach((fn) => fn()));

  // Apply the persisted theme to <html data-theme="…"> whenever it changes.
  createEffect(() => {
    document.documentElement.setAttribute("data-theme", theme());
  });

  return (
    <div
      class="shell"
      data-show-left={showLeftPanel() ? "true" : "false"}
      data-show-right={showRightPanel() ? "true" : "false"}
    >
      <div class="shell__tabs tabs">
        <div class="tabs__leading">
          <button class="tabs__leading-btn" type="button" title="Open repository" onClick={openRepoPicker}>
            <IconOpenFolder />
          </button>
          <button class="tabs__leading-btn" type="button" title="Favorites" disabled>
            <IconStar />
          </button>
        </div>
        <div class="tabs__list">
          <Show when={repoPath()} fallback={<SingleTab label="New Tab" active />}>
            <SingleTab label={repoPath()!.split("/").filter(Boolean).pop() ?? "Repo"} active />
          </Show>
          <button class="tabs__leading-btn tabs__new" type="button" title="New tab" aria-label="New tab">
            <IconPlus />
          </button>
        </div>
      </div>

      <div class="shell__toolbar">
        <Toolbar onOpenRepo={openRepoPicker} />
      </div>

      <div class="shell__sidebar">
        <LeftSidebar />
      </div>

      <div class="shell__main">
        <Show when={repoPath()} fallback={<ColdStart />}>
          <Show
            when={mainView() === "graph"}
            fallback={<FileDiffTab />}
          >
            <div class="main">
              <div class="main__graph-column-headers">
                <span>Branch / Tag</span>
                <span>Graph</span>
                <span>Commit Message</span>
              </div>
              <div class="main__graph-host">
                <CommitGraph repoPath={repoPath()!} />
              </div>
            </div>
          </Show>
        </Show>
      </div>

      <div class="shell__inspector">
        <RightPanel />
      </div>

      <div class="shell__statusbar">
        <StatusBar />
      </div>
    </div>
  );
}

function SingleTab(props: { label: string; active?: boolean }) {
  return (
    <button class="tab" type="button" data-active={props.active ? "true" : "false"}>
      {props.label}
    </button>
  );
}
