# Command palette (and the lack thereof) + keyboard shortcut registry

Does GitKraken ship a VS Code / Sublime-style Ctrl-Shift-P command
palette where every app action is fuzzy-searchable by name? **The
answer from the bundle is: no, not in the VS Code sense.** What
GitKraken has instead is a **Fuzzy Finder** that searches *domain
objects* (repos, branches, commits, tags, files) rather than
*commands*. There is no `commandPalette`, `cmdPalette`, `quickOpen`,
`commandRegistry`, `CommandBarScope` or equivalent symbol anywhere in
the bundle. Keyboard access to actions goes through a separate,
smaller **keybinding / hotkey registry** wired up to DOM-level
listeners and to Electron's native accelerator for menu items.

This file documents both systems because jointly they cover what a
command palette would otherwise provide.

## Fuzzy Finder (the closest thing to a palette)

`FuzzyFinder` is toggled by `toggleFuzzyFinder` / `ToggleFuzzyFinder`
and exposes `FuzzyFinderButtonTooltip` on the toolbar. Unlike VS
Code's palette, it is **domain-scoped**: the user first picks a
domain (`FuzzyFinderDomainSelected`, `openFuzzyFinderForDomainSaga`),
then types to filter items in that domain. Domains include repos
(`FuzzyFinderOpenRepo`, `getFuzzyFinderOpenRepoId`), commits
(`selectCommitFromFuzzyFinderSaga`), and a generic item set
(`getFuzzyFinderItemsByDomain`, `FuzzyFinderItemsByDomain`). The
picker is a navigator, not an arbitrary-command launcher.

### Ranking

Results are not ranked by raw fuzzy score alone. GitKraken layers
**frecency** on top: `FuzzyFinderFrecencyConstants`,
`getFuzzyFinderFrecencyMetadata`,
`getFuzzyFinderFrecencyItemMetadataByDomain`,
`getFuzzyFinderFrecencyQueryMetadataByDomain`, `itemFrecencyScore`,
`queryFrecencyScore`, `frecencyCutoffs`,
`updateFuzzyFinderFrecencyItemMetadataSaga`. Both the *item* (which
repo you opened) and the *query* (the characters you typed) get
frecency scores, so typing "ca" prefers "capydeploy" over "capacity"
if you open the former more often. `getFuzzyFrecencyFilteredItems`
is the combined filter + rank function. The fuzzy matching uses
internal helpers (`fuzzyScore`, `fuzzyGet`, `fuzzyValue`,
`fuzzyPropertyNames`) — no reference to fuse.js / fzy / fzf,
suggesting a hand-rolled subsequence scorer.

### History

`FuzzyFinderHistory`, `toggleFuzzyFinderHistory`, `FuzzyFinderOpened`,
`FuzzyFinderItemSelected`, `FuzzyFinderItemsSelected`,
`clearFuzzyFinderSelectionTask` — a recent-items list surfaced when
the query is empty, backed by analytics events.

### Dev items

`fuzzyFinderDevNewTabWidgetItems` and `getFuzzyFinderDevItems` —
hidden domain used for internal development tooling, not exposed to
end users.

## Keyboard shortcut registry

Since there is no command-runner palette, hotkeys are the actual
keyboardless path to trigger actions. The registry is composed of:

- `Keybinding`, `toKeybinding`, `_asKeybinding`, `_computeKeybinding`
  — internal representation of a key chord (modifiers + key code).
- `Hotkey`, `hotkey`, `ListHotkeys` — higher-level action wrapper
  binding a `Keybinding` to a handler.
- `onOpenKeybindingsModal` — shortcut that opens the "Keyboard
  Shortcuts" preferences pane.
- `reservedShortcutKeys`, `shortcutKeys`, `shortcuts` — the table of
  known bindings used to render the help panel and detect conflicts.
- `getShouldIgnoreCoreKeybinding` — predicate that suppresses
  built-in shortcuts while a text input has focus (so typing "p" in
  a commit message doesn't trigger Push).
- `disableKeybinding` — programmatic override when a modal owns the
  key space.
- `toggleRefPanelDeprecatedKeybinding` — evidence that shortcuts
  have a versioning / deprecation path.

Conflict resolution is structural: each hotkey sits in a scope
(toolbar, modal, text-input) and a scope-aware dispatch picks the
innermost active scope at event time. `reservedShortcutKeys` is what
the settings UI uses to block a user from re-binding system-level
shortcuts.

### Per-OS differences

`toElectronAccelerator` is the bridge from GitKraken's internal
`Keybinding` shape to the Electron main-process accelerator format
used by the native menu bar. This is the only place where
Cmd-vs-Ctrl translation happens — `Mod` / `CommandOrControl` in the
internal shape expands to `Cmd` on macOS and `Ctrl` elsewhere via
Electron's own accelerator parser. No per-OS branches exist in the
render bundle itself beyond this conversion.

### Hint rendering

`menuShortcut`, `menuShortcutText`, `ariaKeyShortcuts` render the
greyed-out shortcut hint in dropdown menus and expose it to screen
readers via the ARIA `aria-keyshortcuts` attribute.
`getActionInfoByShortcut` is the reverse lookup used when the user
presses a key and the UI needs to highlight the matching menu item
briefly.

### Interactive rebase sub-scope

`getInteractiveRebaseShortcuts` is a dedicated scoped keymap — the
rebase UI (doc 19) owns its own shortcut set (pick / squash / reword
/ drop single-letter commands) that overrides the global set while
it is visible.

## Algorithm (pseudocode)

```
# Fuzzy finder
saga onFuzzyFinderQuery(q, domain):
    items = getFuzzyFinderItemsByDomain(domain)
    freq  = getFuzzyFinderFrecencyItemMetadataByDomain(domain)
    qFreq = getFuzzyFinderFrecencyQueryMetadataByDomain(domain)[q]
    scored = items.map(it => {
        item: it,
        score: fuzzyScore(q, it.searchText)
             + itemFrecencyScore(freq[it.id])
             + queryFrecencyScore(qFreq?.preferredItems[it.id])
    })
    return scored
        .filter(score > frecencyCutoffs.min)
        .sortDesc()

# Hotkey dispatch
on keydown(ev):
    kb = toKeybinding(ev)
    if getShouldIgnoreCoreKeybinding(activeElement): return
    scope = innermostActiveScope()
    handler = scope.hotkeys[kb] ?? global.hotkeys[kb]
    if handler:
        handler()
        ev.preventDefault()
```

## Yryvu implications

- **Decide early: command-runner palette or navigator palette?**
  GitKraken chose navigator, which fits a Git client better because
  90 % of user intent is "go to X object", not "invoke Y action".
- **Build the domain-scoped fuzzy finder first**, add frecency (both
  item and query dimensions — GitKraken's two-axis model is right),
  and keep commands in a flat hotkey registry that renders its help
  in a modal.
- **Copy the "ignore core keybinding while input is focused"
  predicate literally** — it is the source of the most common "why
  did my commit message turn into a push" bug report.
- **If you ever add a command palette on top**, make it a
  **separate** domain in the same fuzzy finder rather than a
  parallel system.
- **Per-OS accelerator bridge** (`CommandOrControl` ↔ `Cmd`/`Ctrl`)
  belongs in one spot.

## Source locations

- `/tmp/gk-asar/src/render/static/entryPoints/main/render.bundle.js`
- Symbols: `FuzzyFinder`, `toggleFuzzyFinder`,
  `FuzzyFinderButtonTooltip`, `openFuzzyFinderForDomainSaga`,
  `FuzzyFinderDomainSelected`, `FuzzyFinderOpenRepo`,
  `selectCommitFromFuzzyFinderSaga`, `getFuzzyFinderItemsByDomain`,
  `FuzzyFinderFrecencyConstants`, `getFuzzyFinderFrecencyMetadata`,
  `getFuzzyFinderFrecencyItemMetadataByDomain`,
  `getFuzzyFinderFrecencyQueryMetadataByDomain`,
  `itemFrecencyScore`, `queryFrecencyScore`, `frecencyCutoffs`,
  `updateFuzzyFinderFrecencyItemMetadataSaga`,
  `getFuzzyFrecencyFilteredItems`, `fuzzyScore`, `fuzzyGet`,
  `FuzzyFinderHistory`, `toggleFuzzyFinderHistory`, `Keybinding`,
  `toKeybinding`, `_computeKeybinding`, `Hotkey`, `ListHotkeys`,
  `onOpenKeybindingsModal`, `reservedShortcutKeys`, `shortcutKeys`,
  `getShouldIgnoreCoreKeybinding`, `disableKeybinding`,
  `toElectronAccelerator`, `menuShortcut`, `ariaKeyShortcuts`,
  `getActionInfoByShortcut`, `getInteractiveRebaseShortcuts`.
- Symbols **not found** (confirming absence of a classic command
  palette): `commandPalette`, `cmdPalette`, `quickOpen`,
  `commandRegistry`, `CommandBarScope`, `registerCommand`,
  `runCommand`.
