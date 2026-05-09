# Staging UI — hunk overlays + line button overlays

GitKraken's per-hunk and per-line staging actions are implemented as
Monaco **overlay widgets** positioned over the diff editor. Two
systems coexist: persistent hunk-header overlays (one per hunk) and
ephemeral line-button overlays (one per moused-over line).

## Architecture

Both systems use Monaco's `IOverlayWidget` API:

```js
editor.addOverlayWidget(widget);
editor.removeOverlayWidget(widget);
```

Overlays are absolute-positioned React subtrees rendered via
`ReactDOM.render` into DOM nodes the widget owns. Their positions are
recomputed on scroll / layout change.

## Hunk header overlays — `createAndUpdateHunkHeaderOverlays`

A persistent widget per hunk, visible **only in HUNK view mode**
(`fileDisplayMode === HUNK`). Rendered at the top edge of each hunk's
line range.

```js
createAndUpdateHunkHeaderOverlays = (maybeForcedValue) => {
  const {hunks, hunkHeaderOverlays, props} = this;
  const {diffType, fileDisplayMode, safeToModifyIndexContents} = props;
  const modifiedEditor = this.diffEditor.getModifiedEditor();
  const originalEditor = this.diffEditor.getOriginalEditor();
  const lineHeight = getOptionValue(modifiedEditor, "lineHeight");

  // Bail if not in HUNK mode
  if (fileDisplayMode !== HUNK) {
    this.destroyHunkHeaderOverlays();
    return;
  }

  // Compute visible-window bounds
  const scrollTop = modifiedEditor.getScrollTop();
  const editorHeight = modifiedEditor.getLayoutInfo().height;
  const viewportEnd = scrollTop + editorHeight + lineHeight;

  // For each hunk: if its top-line pixel position is within the viewport,
  // position/create the overlay. Otherwise remove it.
  const visibleOverlayTops = computeVisibleOverlayTops(hunks, scrollTop, viewportEnd);

  // Reposition existing overlays, unmount those that left the viewport
  for (const {id, domNode, widget} of hunkHeaderOverlays) {
    const top = visibleOverlayTops[id];
    if (top === undefined) {
      modifiedEditor.removeOverlayWidget(widget);
      ReactDOM.unmountComponentAtNode(domNode);
    } else {
      domNode.style.top = `${top - scrollTop - 25}px`;  // -25 offset to sit above hunk
    }
  }

  // Create new overlays for hunks that just entered the viewport
  // (minHeight/maxHeight 26px, width 100%, React.createElement into DOM node)
  // ...
};
```

Key details:

- Height **26 px** (`minHeight: "26px"; maxHeight: "26px"`).
- Width **100%** (spans the editor width).
- Position offset `-25 px` relative to scrollTop-adjusted line top (sits
  immediately above the hunk's first line).
- Only rendered for hunks whose top edge is within the viewport (plus a
  1-line-height cushion).
- Unmounted on scroll out of viewport (memory-friendly — we don't keep
  React trees for off-screen hunks).

## Hunk overlay content

The actual React subtree per hunk (observed in bundle):

```jsx
<span className="mr3 mb1">
  <Button bsStyle="..." onClick={stageHunk}>Stage Hunk</Button>
  <Button bsStyle="..." onClick={discardHunk}>Discard Hunk</Button>
  {/* or Unstage Hunk if on staged side */}
  {/* Revert Hunk / custom menu */}
</span>
```

Buttons gated by `shouldAllowHunkStaging` prop and `listType`:
- `listType === UNSTAGED`: Stage / Discard / Revert.
- `listType === STAGED`: Unstage.
- `listType === CONFLICTED`: custom conflict-resolver buttons (doc 18 from graph research).

## Line button overlays — `buildLineButtonOverlays`

Ephemeral widget rendered at the **mouse-hovered line** when staging
is allowed. Single widget total, repositioned on mouse move.

```js
buildLineButtonOverlays = () => {
  const {scrollTopToLineNumberMap, mousePosition, props} = this;
  const {diffType, fileDisplayMode, listType, shouldAllowHunkStaging} = props;

  // Only in UNSTAGED/STAGED views with staging allowed + modified side
  if (!((listType === UNSTAGED || listType === STAGED) &&
        diffType === MODIFIED &&
        shouldAllowHunkStaging)) return;

  // No mouse position yet
  if (!scrollTopToLineNumberMap || (mousePosition.x === -1 && mousePosition.y === -1)) return;

  // Position the overlay at the hovered line
  // ...
};
```

Trigger flow:
- `onMouseMove` within the editor → update `this.mousePosition`.
- Debounced (or throttled) call to `buildLineButtonOverlays`.
- Widget shows a single button ("Stage this line" / "Unstage this line")
  at the right margin of the hovered line.
- Click action dispatches `updateEntryInIndex(entry, lineRange, stage, revert)`
  from doc 03.

Labels:
```
StageThisLine     = "Stage this line"
UnstageThisLine   = "Unstage this line"
StageSelectedLines = "Stage selected lines"   (multi-line selection)
```

When user has a multi-line selection active, the button label swaps to
the "selected lines" variant.

## Overlay lifecycle hooks

The class integrates overlay lifecycle with Monaco events:

```js
componentDidMount() {
  this.createAndUpdateHunkHeaderOverlays();
  this.buildLineButtonOverlays();
}
componentDidUpdate(prev) {
  // Recompute on prop change (mode, file, diffType)
  this.createAndUpdateHunkHeaderOverlays();
  this.buildLineButtonOverlays();
}
onDidChangeModel = () => {
  // Model swapped (new file): recompute
  this.createAndUpdateHunkHeaderOverlays();
  this.buildLineButtonOverlays();
};
onDidUpdateDiff = () => {
  // Diff result changed: rebuild hunk data + overlays
  const changes = this.diffEditor.getLineChanges();
  if (!changes) return;
  this.destroyLineButtonOverlays();
  const {modified:{content:modifiedContent}, original:{content:originalContent}} = this.diff;
  const {hunks, modifiedLines, originalLines} =
    makeHunkDataStructure(originalContent, modifiedContent, changes);
  this.hunks = hunks;
  this.modifiedLines = modifiedLines;
  this.originalLines = originalLines;
  this.setState({areHunksEmpty: hunks.length === 0});
};
// + onScroll listener repositions overlays
```

## Hunk data structure

`makeHunkDataStructure(original, modified, lineChanges)` returns:

```ts
{
  hunks: Hunk[];
  modifiedLines: LineRecord[];
  originalLines: LineRecord[];
}
```

Built from Monaco's `getLineChanges()` output plus the raw text of
both sides. Enables the per-hunk Stage/Discard operations to compute
their target line range correctly.

## `shouldAllowHunkStaging` gating

This prop is `true` only when:
- The diff is against the working directory or index (not a commit-to-commit diff).
- The current view is File or Diff of a staging-relevant side.
- Repo state is normal (no active rebase/cherry-pick blocking staging).

When `false`, overlays are not rendered — the diff becomes read-only
visually.

## Yryvu implications

- **Use Monaco's IOverlayWidget API directly** — don't invent a parallel
  positioning system. Solid components mount via `render()` from
  `solid-js/web` into the DOM nodes the widget owns.
- **Lazy mount / unmount** overlays based on viewport — keep memory
  proportional to visible hunks, not total hunks.
- **Single ephemeral line-button overlay** for the mouse-hovered line.
  Debounce mouse-move updates (GitKraken doesn't throttle explicitly;
  adopt a 16 ms / 1-frame rAF throttle to avoid redundant positioning
  on fast scroll).
- **Integrate overlay lifecycle** with Monaco's model/scroll/diff events
  — mirror the four lifecycle hooks listed above.
- **`shouldAllowHunkStaging`** gate must honor repo state (no staging
  during rebase/cherry-pick, for example).
- **Multi-line selection** swaps the line-button label.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `createAndUpdateHunkHeaderOverlays` — method name.
- `buildLineButtonOverlays` — line-overlay method.
- `hunkHeaderOverlays` — overlay map.
- `scrollTopToLineNumberMap` — position cache.
- `makeHunkDataStructure` — hunk extractor.
- `shouldAllowHunkStaging` — gating prop.
- `StageThisLine` / `UnstageThisLine` / `StageSelectedLines` — labels.
- `updateEntryInIndex` — stage/unstage saga (doc 03).
