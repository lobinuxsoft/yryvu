# Context menus + keyboard shortcuts

Catalog of the right-click context menus inside the diff editor and
the cross-app keyboard shortcuts that touch the diff viewer. Source:
the `ContextMenu-*` string set and the platform-specific keybinding
JSONs under `src/keyBindings/`.

## Context menus

### Inside the diff editor body

Right-clicking on a line or selection in the Monaco diff editor:

- Built-in Monaco menu (Copy, Cut, Paste on editable, Change All Occurrences, Find All References, etc.) — inherited, not customized.
- **Plus** GitKraken-added items injected via Monaco's context menu
  contribution API:

| Label                                    | Condition                    | Action |
|------------------------------------------|------------------------------|--------|
| `DiscardThisHunk` / "Discard Hunk"       | Current hunk, unstaged side  | `updateEntryInIndex(entry, range, false, true)` |
| `RevertThisHunk` / "Revert Hunk"         | Unstaged side                | Applies inverse of the hunk to working dir |
| `StageThisHunk` / "Stage Hunk"           | Unstaged side                | `updateEntryInIndex(entry, range, true, false)` |
| `UnstageThisHunk` / "Unstage Hunk"       | Staged side                  | `updateEntryInIndex(entry, range, false, false)` |
| `StageThisLine` / "Stage this line"      | Unstaged, single-line        | Stage the cursor's line only |
| `UnstageThisLine` / "Unstage this line"  | Staged, single-line          | Unstage the cursor's line only |
| `StageSelectedLines` / "Stage selected lines" | Unstaged, multi-line selection | Stage the selected line range |
| `ContextMenu-OpenGijLinkForCommitFileDiff` / "Open Jira to this file diff" | Jira integration enabled, commit has Jira key | Opens Jira URL |
| `ContextMenu-OpenGijLinkForCommitFileDiffOnInstance` | Multiple Jira instances | Submenu per instance |

Visibility driven by:
- `shouldAllowHunkStaging` (gating prop).
- `listType` (UNSTAGED / STAGED / CONFLICTED / COMMIT).
- Current selection state.

### On file list rows (right panel)

When right-clicking a file row in the file list widget (doc 05):

- Open (in diff viewer — the default click does this).
- Open in External Diff / Merge Tool — `FuzzyFinder-OpenFileInExternalCompareTool`.
- Stage File — whole-file stage.
- Unstage File.
- Discard Unstaged Changes — `Discard Unstaged Changes`.
- Show File History — routes to history panel.
- Show Blame.
- Copy Full Path.
- Copy Relative Path.
- Reveal in Finder / Explorer.

File-level actions are shown only when the list type supports them
(e.g., Unstage only for staged, Show History always).

### On hunk-header overlay

The hunk-header overlay widgets (doc 12) expose the Stage/Unstage/
Discard/Revert actions as **buttons** rather than a context menu —
no right-click menu on overlays. (Right-clicking the underlying line
still opens the editor-body context menu.)

## Keyboard shortcuts

### From `src/keyBindings/shared.json`

Shortcuts relevant to the diff viewer:

| Keys                  | Command                                                  | Effect |
|-----------------------|----------------------------------------------------------|--------|
| `Cmd+F`               | `view:focusModalSearchOrOpenCommitSearch`                | Outside editor: commit search. **Inside editor: falls through to Monaco Find** via `overrideKeymap`. |
| `Cmd+Alt+F`           | `leftPanel:focusFilter`                                  | Focus the sidebar filter input. |
| `Cmd+Shift+P`         | `view:toggleFuzzyFinder`                                 | Command palette / fuzzy finder. |
| `Cmd+Shift+H`         | `view:toggleFuzzyFinderHistory`                          | Fuzzy finder scoped to file history. |
| `Cmd+D`               | `select:openSelectedFileInExternalFileCompareTool`       | Open current file in external diff tool. |
| `Cmd+S`               | `mergeResolution:saveAndResolveFile`                     | Mark current file as resolved (in merge mode). |
| `Cmd+Shift+S`         | `repo:stageAll`                                          | Stage all. |
| `U`                   | `repo:unstage`                                           | Unstage selected files. |
| `Cmd+Shift+U`         | `repo:unstageAll`                                        | Unstage all. |
| `Cmd+J`               | `view:toggleRefPanel`                                    | Toggle left sidebar. |
| `Cmd+K`               | `view:toggleDetailPanel`                                 | Toggle right inspector. |
| `Cmd+/`               | `view:toggleKeyBindings`                                 | Show keyboard shortcuts overlay. |
| `Cmd+Y` / `Cmd+Shift+Z` | `core:redo`                                           | Redo (general undo/redo framework). |
| `Cmd+Z`               | `core:undo`                                              | Undo. |
| `Escape`              | `view:close`                                             | Close overlays / modal. |

Command modifier is `Ctrl` on Linux/Windows (per platform JSON files:
`linux.json` and `win32.json`).

### No dedicated diff-only shortcuts

No `g-n` or `]c` / `[c` style bindings for next/previous change —
those are accessed via the toolbar buttons (doc 03) only.

### Markdown Code/Preview toggle

No keyboard shortcut observed. The toggle is click-only.

### Ignore-whitespace toggle

No keyboard shortcut. Toolbar button only.

### View mode (Hunk/Inline/Split)

No keyboard shortcuts. Toolbar buttons only.

## Keybindings dialog

Opened via `Cmd+/`. Shows categorized list from
`keyBindings.KeyBindingHeader-*`:

- Repo Actions
- Navigation
- Command Palette
- UI

Filter input inside the dialog: `KeyBindingFilter-Placeholder`
("Filter shortcuts (Cmd + F)").

Title: `KeyBindingsTooltip` ("Keyboard Shortcuts (Cmd + /)").

Currently **read-only** in GitKraken — no rebind UI observed in the
bundle despite the `KeyBindingFilter` search. Customization happens
by editing the platform JSON files under the user's app-data directory,
or not at all.

**Yryvu has #108** for a full customize-shortcuts editor — goes beyond
GitKraken.

## Yryvu implications

- **Replicate the context menu sets verbatim** — same labels, same
  conditions, same actions.
- **Hunk-header overlay buttons, not right-click menu** on overlays.
- **File-list row context menu** covers the full file-level action set
  — don't bury these in a submenu.
- **Replicate the keybinding JSONs per-platform** — ship
  `darwin.json` / `linux.json` / `win32.json` mirroring GitKraken's
  layout. Platform-key remapping (Cmd ↔ Ctrl) is already per-file, so
  Yryvu's loader just picks the right file.
- **Implement the keybindings dialog** as read-only first (doc 23's
  research shows this is simplest), then #108 extends it with
  rebind/record flow.
- **`overrideKeymap` pattern** (doc 01 / doc 15) is the critical glue
  between Monaco's Find and the global `Cmd+F` binding.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `ContextMenu-OpenGijLinkForCommitFileDiff` — Jira integration entry.
- `Discard Hunk` / `Revert Hunk` / `Stage Hunk` / `Unstage Hunk` — verbatim labels.
- `Stage this line` / `Unstage this line` / `Stage selected lines`.
- `FuzzyFinder-OpenFileInExternalCompareTool` — external tool label.

Keybindings: `src/keyBindings/shared.json`, `darwin.json`, `linux.json`, `win32.json`.

Keybindings strings: `KeyBinding*`, `KeyBindingHeader-*`, `KeyBindingsTooltip`, `KeyBindingFilter-*`.
