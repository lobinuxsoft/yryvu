# Monaco DiffEditor integration

GitKraken renders every diff through **Monaco's** native `DiffEditor` — the
same component VS Code uses. Monaco ships as a separate bundle (`monaco.js`
~2.9 MB) loaded lazily; the render bundle interacts with it through a
`getMonaco()` accessor.

## Instantiation

One container per mode is pre-created. When the user switches view modes,
the editor is rebound to the container registered for that mode — Monaco
is **not** destroyed and recreated between mode changes.

```js
this.diffEditor = getMonaco().editor.createDiffEditor(
  this.containersByFileDisplayMode[fileDisplayMode],
  this.buildDiffOptions()
);
this.diffEditor.onDidChangeModel(/* ... */);
```

The `containersByFileDisplayMode` map keys are the enum values from
`fileDisplayModes` (see doc 02) — `"hunk"`, `"inline"`, `"split"` —
with `"content"` using a different, non-diff editor path.

## Options passed to `createDiffEditor`

Captured verbatim from `buildDiffOptions()` in the render bundle:

```js
{
  fontSize: this.props.fontSize,
  ignoreTrimWhitespace: this.props.ignoreWhitespace,
  minimap: void 0,                      // minimap disabled explicitly
  originalEditable: !readOnly,
  readOnly: readOnly,
  renderSideBySide: this.props.fileDisplayMode === SPLIT,  // see doc 02
  scrollBeyondLastLine: false,
  useInlineViewWhenSpaceIsLimited: false,
  wordWrap: this.props.wordWrap ? SETTING_ON : SETTING_OFF,
}
```

Key non-default choices:

- **`minimap: void 0`** — the right-side minimap is suppressed. The diff
  column is intended to be focused reading, not code navigation.
- **`scrollBeyondLastLine: false`** — no empty whitespace past the last
  line.
- **`useInlineViewWhenSpaceIsLimited: false`** — Monaco's own
  "auto-switch to inline when the pane is narrow" is disabled. GitKraken
  wants view mode to be entirely user-controlled.
- **`originalEditable`** inverted from `readOnly` — when staging from the
  modified pane is disabled, the original pane also goes read-only (same
  gate, propagated).
- **`wordWrap: SETTING_ON | SETTING_OFF`** — toggled from the diff toolbar
  (see doc 02), wired into Monaco's standard `wordWrap` option.

## Model wiring

Monaco's `ITextModel` is created once per (repo, file, side) triple and
reused across mode changes. The mapping is tracked by `onDidChangeModel`
handlers that fire whenever the active model changes — the wrapper
component uses this to refresh hunk-level decorations (see doc 03) and
re-sync the line-change map with Redux.

## Line-change introspection

Prev/next-change navigation (doc 03), selection-derived hunk info, and
staging selection handles all go through Monaco's `getLineChanges()` API
plus helpers:

```js
const changes = this.diffEditor.getLineChanges();
const {equivalentLineNumber} =
  getDiffLineInformationForOriginal(changes, line);
const {equivalentLineNumber} =
  getDiffLineInformationForModified(changes, line);
```

`getLineChanges()` returns `ILineChange[]` — Monaco's standard structure
with `originalStartLineNumber`, `originalEndLineNumber`,
`modifiedStartLineNumber`, `modifiedEndLineNumber`, and
`charChanges[]` for intra-line deltas.

`getDiffLineInformationForOriginal` / `...ForModified` are the helpers
Monaco exposes on the diff editor instance to map a line number on one
side to the paired line number on the other side (or null if the line
has no counterpart).

## External bundle: `monaco.js`

- Location: `src/render/static/monaco/monaco.js` (2.9 MB main bundle).
- Chunked lazy modules: `<id>.monaco.js` (dozens of files).
- Workers: `editor.worker.js` (241 KB), `ts.worker.js` (4.8 MB),
  `json.worker.js`, `html.worker.js`, `css.worker.js`.
- Loaded via webpack `import()` from the render bundle; the wrapper
  exposes `getMonaco()` which resolves the promise and caches the module.

## Props surface from the wrapping React component

```ts
interface DiffEditorProps {
  fontSize: number;
  ignoreWhitespace: boolean;
  wordWrap: boolean;
  fileDisplayMode: "hunk" | "inline" | "split";  // "content" uses a different path
  readOnly: boolean;
  height: number;
  width: number;
  onDirty: (isDirty: boolean) => void;
  overrideKeymap: () => void;    // disables global shortcuts while editor focused
  restoreKeymap: () => void;     // restores global shortcuts on blur
  updateDiffNavigatorCallbacks: (
    nextCb: () => void,
    prevCb: () => void
  ) => void;
}
```

`overrideKeymap` / `restoreKeymap` are a defensive handoff — when Monaco
has focus, the app's global command dispatcher is suspended so that
Monaco's `Ctrl+F`, `Ctrl+G`, etc. take precedence. Redispatched on blur.

## Yryvu implications

- **Ship Monaco as a separate chunk** from the main app bundle. For Tauri
  + Solid, this means either `monaco-editor/esm` with `vite-plugin-monaco`
  or the community `@guolao/vite-plugin-monaco-editor`. Target the same
  lazy-load behavior — don't block the main graph render on Monaco.
- **Use `createDiffEditor`**, not `createEditor` — the native diff API
  has the hunk/line-change semantics we need for staging and navigation.
- **Mirror the option set above verbatim**. `minimap: undefined`,
  `scrollBeyondLastLine: false`, `useInlineViewWhenSpaceIsLimited: false`
  are critical to the 1:1 look.
- **Pre-create one container per mode** (or at least toggle
  `renderSideBySide` without tearing down the editor) — destroying and
  recreating Monaco on each mode flip is visibly slow.
- **Keep one model per side per file** and reuse across mode changes —
  otherwise you lose cursor position and Monaco decorations.

## Source locations (bundle offsets)

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns (no stable offsets — symbols minify between builds):

- `createDiffEditor\(this\.containersByFileDisplayMode` — the
  instantiation call.
- `buildDiffOptions=\(\)=>\{` — the option builder.
- `ignoreTrimWhitespace:this\.props\.ignoreWhitespace` — the option
  object literal.
- `updateDiffNavigatorCallbacks` — the prev/next callback hookup
  (tracked via Redux action `GoToNextAndPreviousDiffChangeCbsUpdated`).
- `getDiffLineInformationForOriginal` / `...ForModified` — Monaco API
  helpers used for line mapping.

Monaco bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/monaco/monaco.js`
