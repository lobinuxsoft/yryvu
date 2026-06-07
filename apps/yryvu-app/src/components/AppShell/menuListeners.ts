// SPDX-License-Identifier: AGPL-3.0-or-later

import { getVersion } from "@tauri-apps/api/app";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { setShowLeftPanel, setShowTerminalPanel } from "../../state";
import { toggleDetailPanelOpen } from "../../state/detail-panel-layout";
import {
  handleCloseTabShortcut,
  openNewTab,
  openReleaseNotes,
  openRepoManagementTab,
} from "../../tabs/ops";
import { openRepoPicker } from "./repoActions";

/// Register every native-menu event listener the shell responds to and
/// return their unlisten handles for `onCleanup`. The tab keybinds that
/// GTK/WebKit2GTK reserves at the WebView level (Cmd/Ctrl+T, Cmd/Ctrl+W)
/// arrive here via the native Tauri menu — accelerators on menu items
/// capture before GTK gets to them; the rest live in the window keydown
/// listener (`globalKeydown.ts`).
export async function registerMenuListeners(): Promise<UnlistenFn[]> {
  const unlisteners: UnlistenFn[] = [];
  unlisteners.push(await listen("menu:open-repo", () => void openRepoPicker()));
  unlisteners.push(
    await listen("menu:toggle-left-panel", () => setShowLeftPanel((v) => !v)),
  );
  unlisteners.push(
    await listen("menu:toggle-right-panel", () => toggleDetailPanelOpen()),
  );
  unlisteners.push(
    await listen("menu:toggle-terminal", () => setShowTerminalPanel((v) => !v)),
  );
  unlisteners.push(await listen("menu:new-tab", () => void openNewTab()));
  unlisteners.push(
    await listen("menu:close-tab", () => void handleCloseTabShortcut()),
  );
  // Help → Release Notes — captures the current app version at click time,
  // matching GK at bundle:2614 (the version is captured at tab create time
  // so an in-place GK auto-update doesn't drift the open tab). Tauri's
  // `getVersion()` reads from tauri.conf.json.
  unlisteners.push(
    await listen("menu:release-notes", async () => {
      const version = await getVersion();
      void openReleaseNotes(version);
    }),
  );
  unlisteners.push(
    await listen("menu:repo-management", () => void openRepoManagementTab()),
  );
  return unlisteners;
}
