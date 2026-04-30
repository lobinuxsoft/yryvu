# Keybinds

GK uses a string-keyed registry: each saga has a unique command ID (`Tabs.openNewTab`, `Tabs.reopenMostRecentlyClosedTab`, etc.) registered at `bundle:89122-89131`, and a separate dispatcher (`bundle:321562`) maps each ID to the saga creator. The Electron main process registers OS accelerators against the IDs.

Chajá uses Tauri, so the OS-accelerator side is replaced by global `keydown` listeners on `window` (the same pattern already used for undo/redo at `apps/chaja-app/src/components/AppShell.tsx`, see `feedback`/undo cluster #130).

## Registry (bundle:89122-89131)

```js
Tabs: {
    handleCloseTabShortcut: "Tabs.handleCloseTabShortcut",
    openNewTab: "Tabs.openNewTab",
    openReleaseNotes: "Tabs.openReleaseNotes",
    openRepoManagementTab: "Tabs.openRepoManagementTab",
    reopenMostRecentlyClosedTab: "Tabs.reopenMostRecentlyClosedTab",
    selectNextTab: "Tabs.selectNextTab",
    selectPreviousTab: "Tabs.selectPreviousTab",
    selectTabIndex: "Tabs.selectTabIndex",
    toggleTabDropdown: "Tabs.toggleTabDropdown"
}
```

Dispatcher (bundle:321554-321565):

```js
[Ba.toggleTabDropdown]: Dr.toggleTabDropdown,
[Ba.handleCloseTabShortcut]: Dr.handleCloseTabShortcut,
[Ba.openNewTab]: Dr.openNewTab,
[Ba.openReleaseNotes]: Dr.openReleaseNotes,
[Ba.openRepoManagementTab]: Dr.openRepoManagementTab,
[Ba.reopenMostRecentlyClosedTab]: Dr.reopenMostRecentlyClosedTab,
[Ba.selectNextTab]: Dr.selectNextTab,
[Ba.selectPreviousTab]: Dr.selectPreviousTab,
[Ba.selectTabIndex]: Dr.selectTabIndex,
```

## Default accelerators

The bundled renderer does NOT carry the OS-accelerator → command-ID map (Electron's menu/accelerator setup is in the main process source, which doesn't ship in the renderer bundle). The one accelerator that DOES surface in the renderer is on the tab context menu (bundle:283046):

```js
{
    telemetryId: "reopenClosedTab",
    label: An("ContextMenu-ReopenClosedTab"),
    accelerator: "CommandOrControl+Shift+T",
    click: () => dn.dispatch(performTabOperation({ type: REOPEN_LAST_CLOSED }))
}
```

Other defaults are inferred from common cross-app conventions (consistent with VS Code, Chrome, Firefox, Safari):

| Saga | Default accelerator | Notes |
|---|---|---|
| `openNewTab` | `Cmd/Ctrl + T` | universal |
| `handleCloseTabShortcut` | `Cmd/Ctrl + W` | universal |
| `selectNextTab` | `Cmd/Ctrl + Tab` | matches browser convention; some apps use `Cmd+Option+→` on Mac |
| `selectPreviousTab` | `Cmd/Ctrl + Shift + Tab` | universal |
| `selectTabIndex(N)` | `Cmd/Ctrl + 1`..`9` | jumps to tab index 0-8; index 9 = last tab on most apps |
| `reopenMostRecentlyClosedTab` | `Cmd/Ctrl + Shift + T` | confirmed verbatim above |
| `toggleTabDropdown` | (no default) | mouse-only on the chevron — GK doesn't bind a key |
| `openReleaseNotes` | (no default) | menu-driven only |
| `openRepoManagementTab` | (no default) | menu-driven only |

## chajá port

Wire global `keydown` on `window` from `AppShell` (the same component that already owns the undo/redo keybinds — see existing pattern). Use the `isInsideEditable(target)` guard so editor focus suppresses the shortcuts:

```ts
function onKeydown(e: KeyboardEvent) {
  if (isInsideEditable(e.target)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  if (e.key === "t" && !e.shiftKey) { e.preventDefault(); openNewTab(); }
  else if (e.key === "w") { e.preventDefault(); handleCloseTabShortcut(); }
  else if (e.key === "T" && e.shiftKey) { e.preventDefault(); reopenMostRecentlyClosedTab(); }
  else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); selectNextTab(); }
  else if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); selectPreviousTab(); }
  else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); selectTabIndex(+e.key - 1); }
}
```

`isInsideEditable` is the existing helper at `apps/chaja-app/src/utils/dom.ts` (or wherever the undo cluster put it — grep before writing a new one).

**Cmd+W special case**: `handleCloseTabShortcut` (bundle:2561, see doc 02) does a 3-stage fallthrough — close file-history first, else close file-view, else close tab. Port the cascade or Cmd+W will close repos when the user wanted to dismiss a diff. For chajá v1 (no file-history widget), the cascade collapses to "close selected tab" — but reserve the saga name for the future cascade.

## Editable preferences (out of scope for this PR cluster)

GK ships a Keybindings preferences pane (#108) where users can rebind. For chajá, defer that to its own issue (#108 is already open). For #135's sub-PR 5, just hard-wire the defaults above. The keybind registry strings (`Tabs.openNewTab` etc.) are forward-compatible — if #108 lands later, the AppShell handler reads from a `keybinds()` signal indexed by command ID instead of using literal key checks.

## Cross-validation

Two claims worth re-grepping:

1. **Only one accelerator is hardcoded in the renderer** — confirmed by `grep -c accelerator /tmp/gk-bundle-pretty.js`: 5 hits total (Cmd+C copy, Cmd+V paste, Ctrl+L clear-prompt, dynamic browser-back, and the Cmd+Shift+T reopen). The other 8 tab keybinds live in the Electron main process source and aren't extractable from this bundle. Inferred defaults are based on cross-app convention, not bundle evidence.
2. **The dispatcher mapping at bundle:321562 is the single chokepoint** — keybind preferences UI writes to a config; the dispatcher reads from that config at handler time. For chajá, the equivalent chokepoint is the `onKeydown` switch above. Replace the hard-coded literals with a `keybinds()` indexed lookup once #108 lands.
