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
  | { op: "openNewTab" }
  | { op: "closeSelectedTab" }
  | { op: "selectNextTab" }
  | { op: "selectPreviousTab" }
  | { op: "selectTabIndex"; index: number }
  | { op: "reopenMostRecentlyClosedTab" };

/// Match a `KeyboardEvent`-like input against the tab keybind table.
/// Returns the intent or `null` when no keybind matches.
///
/// Accepts a plain shape rather than `KeyboardEvent` so tests can pass
/// literal objects without faking a DOM event.
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

  const k = input.key.toLowerCase();

  if (k === "t" && !input.shiftKey) return { op: "openNewTab" };
  if (k === "w") return { op: "closeSelectedTab" };

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

/// Dispatch the matched intent. Imports the ops module lazily so the
/// matcher can be tested without a Tauri runtime.
export async function runTabKeybind(intent: TabKeybind): Promise<void> {
  const ops = await import("./ops");
  switch (intent.op) {
    case "openNewTab":
      return ops.openNewTab();
    case "closeSelectedTab":
      // The audit doc 05 cascade (file-history → file-view → tab) lives
      // in `handleCloseTabShortcut`. v1 collapses to closeSelectedTab,
      // but route through the cascade saga so future widgets slot in
      // without re-wiring this handler.
      return ops.handleCloseTabShortcut();
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
