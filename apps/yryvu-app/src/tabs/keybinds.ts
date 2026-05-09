// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tab keyboard shortcuts. Pure-function matcher (`matchTabKeybind`) +
 * dispatcher wrapper (`runTabKeybind`). The matcher returns a tagged
 * intent or `null`; the wrapper executes the matching tab op.
 *
 * Splitting match from dispatch makes the matcher testable without a
 * DOM (vitest runs in node — no `document`, no editor focus state). The
 * AppShell `keydown` listener calls both: matcher to decide if to act,
 * dispatcher to fire the op when it does.
 *
 * Defaults inferred from cross-app convention (audit doc 05). The only
 * keybind hardcoded in the GK bundle is Cmd+Shift+T (bundle:283046,
 * `CommandOrControl+Shift+T` accelerator on the reopen-closed-tab
 * context-menu entry). Everything else inferred from VS Code / browser
 * convention.
 *
 * Editable focus is enforced upstream by the AppShell handler — the
 * matcher doesn't see the target. This separation lets the same matcher
 * be reused if a future component owns its own keydown surface.
 */

export type TabKeybind =
  | { op: "selectNextTab" }
  | { op: "selectPreviousTab" }
  | { op: "selectTabIndex"; index: number }
  | { op: "reopenMostRecentlyClosedTab" };

/// Match a `KeyboardEvent`-like input against the tab keybind table.
/// Returns the intent or `null` when no keybind matches.
///
/// Accepts a plain shape rather than `KeyboardEvent` so tests can pass
/// literal objects without faking a DOM event.
///
/// Cmd/Ctrl+T (openNewTab) and Cmd/Ctrl+W (closeSelectedTab) are NOT in
/// this table — they're routed through the native Tauri menu in
/// `apps/yryvu-app/src-tauri/src/menu.rs`. WebKit2GTK reserves both at
/// the WebView level so a `keydown` listener never sees them; menu
/// accelerators capture before GTK gets the chance.
export function matchTabKeybind(input: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): TabKeybind | null {
  const mod = input.metaKey || input.ctrlKey;
  if (!mod) return null;

  // Cmd+Shift+T → reopen most recently closed (the only bundle-confirmed
  // accelerator, bundle:283046). Check before the lowercase comparison
  // since `e.key` for Shift+T is the literal "T" (uppercase) on most
  // platforms but some IMEs emit "t".
  if (input.shiftKey && (input.key === "T" || input.key === "t")) {
    return { op: "reopenMostRecentlyClosedTab" };
  }

  // Cmd+Tab / Cmd+Shift+Tab → next / previous. Ctrl+Tab is the same
  // gesture cross-platform (browser convention). Note: macOS reserves
  // Cmd+Tab for the OS app switcher — Cmd+Tab inside the app rarely
  // fires there. We honor the keybind anyway; if Apple ever forwards
  // it, our handler is ready.
  if (input.key === "Tab" && !input.shiftKey) return { op: "selectNextTab" };
  if (input.key === "Tab" && input.shiftKey) return { op: "selectPreviousTab" };

  // Cmd+1..9 → jump to tab index N-1. The ops layer no-ops on out-of-
  // range indices, so we don't gate length here.
  if (/^[1-9]$/.test(input.key)) {
    return { op: "selectTabIndex", index: Number(input.key) - 1 };
  }

  return null;
}

/// Dispatch the matched intent. Static-imports ops — an earlier draft used
/// `await import("./ops")` to keep the matcher tree-shakeable from tests,
/// but the async fence introduced a measurable latency between Cmd+T and
/// the new pill landing (the import promise resolves on a microtask after
/// preventDefault runs). The matcher is already pure; the dispatcher
/// pulls in ops directly.
import * as ops from "./ops";

export function runTabKeybind(intent: TabKeybind): Promise<void> {
  switch (intent.op) {
    case "selectNextTab":
      return ops.selectNextTab();
    case "selectPreviousTab":
      return ops.selectPreviousTab();
    case "selectTabIndex":
      return ops.selectTabIndex(intent.index);
    case "reopenMostRecentlyClosedTab":
      return ops.reopenMostRecentlyClosedTab();
  }
}
