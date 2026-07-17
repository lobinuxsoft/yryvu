// SPDX-License-Identifier: AGPL-3.0-or-later

import { openCommandPalette } from "../CommandPalette/state";
import { toggleDetailPanelOpen } from "../../state/detail-panel-layout";
import { matchTabKeybind, runTabKeybind } from "../../tabs/keybinds";
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

/// Window-level keyboard dispatch for the shell. Skips editable targets so
/// the commit-message editor and dialog inputs keep native Ctrl+Z. Tauri
/// abstracts the platform — `metaKey || ctrlKey` covers Cmd on macOS and
/// Ctrl on Linux / Windows; `Ctrl+Y` is also accepted as a Windows-style
/// Redo alias.
export function handleGlobalKeyDown(e: KeyboardEvent): void {
  if (isInsideEditable(e.target)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const key = e.key.toLowerCase();

  // Command palette (issue #14): Ctrl/Cmd+P. Cmd+K used to also open the
  // palette, but GK binds it to the inspector toggle (audit doc
  // 01-panel-chrome.md → `RightPanel.toggleDetailPanel`) and that's the
  // user-visible expectation when porting from GK.
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

  // Undo / Redo (issue #187, #130 cluster). `e.repeat` bails so holding
  // the combo can't fire a burst of overlapping undos — each is a fresh
  // deliberate keypress or nothing (#472).
  if (key === "z" && !e.shiftKey) {
    e.preventDefault();
    if (e.repeat) return;
    void runUndo();
    return;
  }
  if ((key === "z" && e.shiftKey) || key === "y") {
    e.preventDefault();
    if (e.repeat) return;
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
}
