# Search within the diff — Monaco find widget + commit search

GitKraken **does not** implement a custom search UI inside the diff
editor. It delegates to Monaco's native **Find Widget** (`Ctrl+F` or
`Cmd+F`). GitKraken's own search features (`Cmd+Shift+F` fuzzy finder,
commit search) target different scopes and live outside the editor.

## Inside-editor search — Monaco's Find

When the diff editor has focus, pressing `Cmd+F` (macOS) / `Ctrl+F`
(Linux/Windows) opens Monaco's built-in Find Widget. Features
inherited for free:

- Substring search.
- Regex mode (toggle in widget).
- Case sensitivity (toggle).
- Whole-word (toggle).
- Replace panel (when editor is editable — Chajá's diff is normally
  read-only, so Replace is hidden).
- Find in selection (toggle in widget).
- Match highlighting + count.
- Enter / Shift+Enter to jump between matches.

Widget appears in both panes of the side-by-side view
(`findWidgetViewZones = {modified: null, original: null}`). The two
panes' find widgets are independent — searching in the modified side
doesn't highlight matches in the original.

## Keyboard override — `overrideKeymap` / `restoreKeymap`

From doc 01:

```ts
{
  overrideKeymap: () => void;
  restoreKeymap: () => void;
}
```

When Monaco has focus (`onDidFocusEditorText` fires), the wrapper
component calls `overrideKeymap()` which **suspends the app's global
keyboard dispatcher**. This ensures `Ctrl+F` goes to Monaco's Find
instead of GitKraken's `view:focusModalSearchOrOpenCommitSearch`
handler (`command-f` binding in `keyBindings/shared.json`).

On blur (`onDidBlurEditorText`), `restoreKeymap()` rehooks the global
dispatcher.

## Outside-editor search — commit search + fuzzy finder

These are **not** inside the diff, but listed here for context since
they're often conflated with diff-search:

- **`Cmd+F` when editor not focused** → opens **modal commit search**
  (searches commit messages, authors, sha prefixes, and file paths).
- **`Cmd+Shift+F`** → **Fuzzy Finder / Command Palette** (doc 23 from
  graph research).
- **`Cmd+Shift+H`** → Fuzzy Finder scoped to file history.

These are keyed on `command-f` mapping to
`view:focusModalSearchOrOpenCommitSearch` (see `keyBindings/shared.json`).

## No cross-file search in the diff panel

GitKraken does NOT let you search "across all files in this commit".
If you want that, you use the Fuzzy Finder's "Files" domain. The diff
editor's Find is per-file.

## No "Find next" / "Find previous" toolbar buttons

The prev/next arrows in the diff toolbar (see doc 03) navigate
**hunks**, not search matches. Different affordance. Monaco's Find
Widget has its own up/down arrows for match navigation.

## Regex in commit search

The modal commit search uses MiniSearch (see doc 23) with its own
tokenizer; regex is **not** supported there. Regex is only in Monaco's
Find for inside-file search.

## Persistence

Neither Monaco's widget state (query, regex flag) nor the commit search
bar's state persists across sessions — each is session-scoped.

## Chajá implications

- **Don't build a custom in-editor find**. Monaco's is excellent.
- **Implement `overrideKeymap` / `restoreKeymap` pattern** — critical
  to avoid `Cmd+F` conflict between Monaco and the global dispatcher.
  Without it, Monaco's find never gets the keystroke.
- **Commit search / fuzzy finder** (scope: #14 fuzzy finder) are
  separate features — don't entangle them with diff search.
- **No regex in commit search** — matches GitKraken. MiniSearch with
  fuzzy matching is the clone-target (per doc 23).
- **Two independent find widgets** in side-by-side mode. Do not try to
  sync them — user expectation is independent search per pane.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `findWidgetViewZones={modified:null,original:null}` — the two-pane
  find widget registration.
- `overrideKeymap` / `restoreKeymap` — global keymap suspension.
- `view:focusModalSearchOrOpenCommitSearch` — the `Cmd+F` target when
  editor isn't focused.

Keybindings file:

- `/var/mnt/DATA/gitkraken-extract/app/src/keyBindings/shared.json`
  — `command-f` mapping to the command above.
