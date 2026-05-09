# View modes — Hunk / Inline / Split / Content

GitKraken's file viewer exposes **four** display modes through a single
Redux-backed enum. Three are diff modes (Hunk, Inline, Split) and one is
a non-diff file-content viewer (Content / "File View").

## Enums

Two enums coexist in the bundle:

```js
at.fileDisplayModes = {
  CONTENT: "content",
  HUNK:    "hunk",
  INLINE:  "inline",
  SPLIT:   "split",
};

at.diffDisplayModes = {
  HUNK:    "hunk",
  INLINE:  "inline",
  SPLIT:   "split",
};
```

`fileDisplayModes` is the full set used when deciding what to render.
`diffDisplayModes` is the restricted set for toolbar toggles that only
apply when a diff is being shown — the UI uses this to gate whether the
"File View" vs "Diff View" toggle is even relevant.

**Default is `HUNK`** — seen in init state:

```js
diffDisplayMode: diffDisplayModes.HUNK,
mode: fileDisplayModes.HUNK,
```

## Mode semantics

| Mode     | Meaning                                                   | Monaco renderSideBySide | Notes |
|----------|-----------------------------------------------------------|--------------------------|-------|
| `content`| File View — current file content, no diff, editable-gated | n/a — uses a non-diff editor path | "File View" label |
| `hunk`   | Hunk-by-hunk view — only changed hunks, stacked vertically | false                    | Default |
| `inline` | Unified inline diff — one column, `+`/`-` gutter markers   | false                    | — |
| `split`  | Side-by-side diff — two columns, original left, modified right | true                 | — |

The `renderSideBySide` Monaco option is derived from:

```js
renderSideBySide: this.props.fileDisplayMode === SPLIT
```

so `hunk` and `inline` both feed the editor in unified-column form, and
the difference between them is in which model is set (hunks-only vs
full file) plus decoration policy.

## Toolbar toggle buttons

Four buttons in the diff options row (`data-testid="diff-options"`):

| Button ID                    | Label key                     | Icon                | Active when            |
|------------------------------|-------------------------------|---------------------|-----------------------|
| `previousDiffButton`         | `FileViewPanel-PreviousDiff`  | `["fas","arrow-up"]`    | — (action, not toggle) |
| `nextDiffButton`             | `FileViewPanel-NextDiff`      | `["fas","arrow-down"]`  | — (action)             |
| `toggleHunkViewButton`       | `FileViewPanel-HunkView`      | `["far","list-alt"]`    | `mode === HUNK`        |
| `toggleInlineViewButton`     | `FileViewPanel-InlineView`    | `["far","list"]`        | `mode === INLINE`      |
| `toggleSplitViewButton`      | `FileViewPanel-SplitView`     | `["far","columns"]`     | `mode === SPLIT`       |
| `ignore-whitespace-button`   | `FileViewPanel-IgnoreWhiteSpace` | `["far","paragraph"]` | `ignoreWhitespace`    |

(`far` = Font Awesome Regular, `fas` = Font Awesome Solid. Yryvu will
need an equivalent icon set — Phosphor has matching glyphs.)

Two additional top-level toggles (File View vs Diff View):

| Button caption            | Key                        | Checked when             |
|---------------------------|----------------------------|---------------------------|
| `FileViewPanel-FileView`  | "File View"                | `mode === CONTENT`        |
| `FileViewPanel-DiffView`  | "Diff View"                | `mode !== CONTENT`        |

So the UI has a two-layer toggle: (1) File vs Diff; (2) within Diff,
Hunk/Inline/Split.

## Markdown sub-mode

For Markdown files, the File View sub-toggles between Code and Preview:

```js
FileViewMode.CODE     // syntax-highlighted code view
FileViewMode.PREVIEW  // rendered HTML preview
```

Toggle buttons:
- `caption: "FileViewPanel-FileViewCode"` (`checked: mode === CODE`)
- `caption: "FileViewPanel-FileViewPreview"` (`checked: mode === PREVIEW`)

`data-testid="markdown-code"` / `"markdown-preview"`.

This lives in a separate enum `FileViewMode` scoped to Markdown — do not
conflate with the top-level `fileDisplayModes`.

## Redux-side flow

Mode changes dispatch through a saga, not directly:

```js
// Action creator (typed as FileDisplayModeSet)
FileDisplayModeSet(mode: FileDisplayMode)

// Saga
function* trySetFileDisplayMode(mode) {
  // guard: don't change away from CONTENT if dirty, etc.
  if (/* guards pass */) {
    yield put(FileDisplayModeSet(mode));
  }
}
```

Gate observed in the bundle:

```js
if (!(Ve !== fileDisplayModes.CONTENT) && /* isDirty check */ ) {
  // skip
} else {
  yield put(FileDisplayModeSet(mode));
}
```

So switching **into** CONTENT while the modified file is dirty is
blocked — the user must save or discard first.

When a file is selected fresh from the file list, the default applies:

```js
const mode = getStoredMode(/* repoPath, filePath */) ?? fileDisplayModes.HUNK;
yield call(trySetFileDisplayMode, mode);
```

The persisted `diffDisplayMode` is read from `["ui","diffView","diffDisplayMode"]`
path in Redux state (per-profile, same shape as graph column settings).

## Metrics distinction

`CONTENT` vs the three diff modes is sent to metrics as a two-value
field:

```js
additionalPayload: {
  viewMode: mode === CONTENT ? "file" : "diff",
  isShowingBlame: /* ... */,
}
```

Not `"hunk" | "inline" | "split"` — just the coarse "file vs diff" pair.
Individual diff modes aren't tracked.

## Yryvu implications

- **Replicate all 4 modes** including CONTENT. We already have a
  diff-only viewer; adding CONTENT is a pure Monaco editor (not
  DiffEditor) instance on the same model.
- **Two-layer toggle UI**: File View / Diff View outer button pair, then
  Hunk / Inline / Split inner button group when in Diff.
- **Default to HUNK** on first open of every file.
- **Persist the mode** per-profile (mirror `ui.diffView.diffDisplayMode`
  path semantics). Do **not** persist per-repo — user preference
  transfers across clones.
- **Block CONTENT when dirty** — same guard, same UX (show a toast or
  inline message pointing to save/discard).
- **Block mode switch when Monaco is mid-transition**: Monaco's model
  change is async; wire `onDidChangeModel` to the mode enum so the
  toolbar reflects the real state, not the optimistic state.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `fileDisplayModes=\{CONTENT:"content"` — enum definition.
- `diffDisplayModes=\{HUNK:"hunk"` — restricted enum.
- `buildButton\("toggleHunkViewButton"` — toolbar wiring.
- `trySetFileDisplayMode` — saga entry point.
- `FileDisplayModeSet` — action creator.
- `additionalPayload:\{viewMode:zn===Vr\.fileDisplayModes\.CONTENT\?"file":"diff"` — metrics branch.
