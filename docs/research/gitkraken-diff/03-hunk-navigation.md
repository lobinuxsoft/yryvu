# Hunk navigation — prev/next change, selection, line mapping

GitKraken's "Next Change" / "Previous Change" buttons, the selection-to-
hunk mapping, and the Revert/Discard/Stage-Hunk context actions all ride
on top of Monaco's `getLineChanges()` API.

## Toolbar buttons

```
previousDiffButton   caption: "FileViewPanel-PreviousDiff"   icon: ["fas","arrow-up"]
nextDiffButton       caption: "FileViewPanel-NextDiff"       icon: ["fas","arrow-down"]
```

They are plain action buttons (not toggles) rendered at the left of the
diff options toolbar, before the view-mode group.

Clicking dispatches the saved callback from Redux (see below) — the
buttons don't close over a diff reference directly.

## Prev/next callbacks — Redux-backed

The diff editor wrapper registers navigation callbacks with the store
every time a new model loads:

```js
updateDiffNavigatorCallbacks: (nextCb, prevCb) =>
  dispatch(GoToNextAndPreviousDiffChangeCbsUpdated(nextCb, prevCb))
```

The store holds the latest pair of function references. The toolbar
buttons read `state.diffNavigator.next` / `.prev` and invoke on click.

Why through Redux instead of direct prop drilling: the toolbar is mounted
in a sibling component tree (the header area) separate from the editor
body. Redux is the shared channel.

## Computing next/prev

The callbacks use Monaco's API directly — no custom hunk walk:

```js
const changes = this.diffEditor.getLineChanges();   // ILineChange[]
// find the hunk whose range brackets the current cursor
// advance / rewind index, scroll editor to that hunk
```

`getLineChanges()` returns the ordered list of `ILineChange`:

```ts
interface ILineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
  charChanges?: ICharChange[];
}
```

Null/zero end-line numbers mark pure additions (no original counterpart)
or pure deletions (no modified counterpart).

## Selection-to-hunk mapping

On every cursor move, the editor pulls the change info for the current
selection:

```js
const {startLineNumber, endLineNumber} = editor.selection;
const changes = this.diffEditor.getLineChanges();
isMultiLine.set(startLineNumber !== endLineNumber);

const {equivalentLineNumber: origStart} =
  getDiffLineInformationForOriginal(changes, startLineNumber);
const {equivalentLineNumber: origEnd} =
  getDiffLineInformationForOriginal(changes, endLineNumber);

const {equivalentLineNumber: modStart} =
  getDiffLineInformationForModified(changes, startLineNumber);
const {equivalentLineNumber: modEnd} =
  getDiffLineInformationForModified(changes, endLineNumber);
```

Two symmetrical API calls, one per side. `equivalentLineNumber` is the
line's counterpart on the other side — used when a staging action
starts from one pane and needs to apply to the other.

The helpers live on the Monaco diff editor instance. They handle the
gaps (additions have no `originalEquivalent`; deletions have no
`modifiedEquivalent`) by returning `null` or `0`.

## Hunk action context menu

The line-change list is also the source for the per-hunk actions:

- `DiscardThisHunk` ("Discard Hunk")
- `RevertThisHunk` ("Revert Hunk", tooltip: "Apply the inverse of this
  hunk to your working directory")
- `StageThisHunk` ("Stage Hunk")
- `UnstageThisHunk` ("Unstage Hunk")
- `StageThisLine` ("Stage this line")
- `UnstageThisLine` ("Unstage this line")
- `StageSelectedLines` ("Stage selected lines")

The menu is contextual: whichever hunk brackets the cursor is the
target. If multi-line selection is active, the "selected lines" variants
become available (the `isMultiLine` state tracks this).

Actions are scoped per side of the editor:

- Working-directory diff (unstaged): Discard / Revert / Stage.
- Index diff (staged): Unstage.

## Selection → index entry update

After a Stage Hunk / Stage Line action, the wrapper dispatches:

```js
stageContent: (at, ct) => dispatch(updateEntryInIndex(at, ct, true, false))
unstageContent: (at, ct) => dispatch(updateEntryInIndex(at, ct, false, false))
```

`updateEntryInIndex(entry, selectionRange, stage, revert)` is the
back-end saga that writes to the Git index via a partial `git apply`
with the line range cropped from the editor.

The diff editor does **not** roll its own patch — it hands the current
line-range selection to the back-end and expects the index to refresh.

## Next-change behavior edge cases

- **No changes**: the callback is a no-op. Toolbar buttons stay enabled
  but dispatch does nothing.
- **Cursor outside any hunk**: "next" jumps to the first hunk ≥ current
  line; "prev" jumps to the last hunk ≤ current line.
- **End of list**: "next" at the last hunk wraps? **Observed behavior:
  no wrap — the cursor stays on the last change.** Prev at the first
  change also no-ops.
- **Cross-mode**: when switching from Hunk → Split, the line-change list
  is recomputed against the full file instead of the hunks-only
  rendering; the navigation still works, just over a different index.

## Chajá implications

- **Store next/prev callbacks in a global signal**, same architecture —
  the toolbar is far from the editor in the component tree, and the
  signal is the clean channel.
- **Use Monaco's `getLineChanges()`** directly — no need to reimplement
  hunk walking on top of `chaja-bridge` diff output.
- **Wire the line-mapping helpers** (`getDiffLineInformationForOriginal`
  / `...ForModified`) for staging. They handle add/delete gap cases
  correctly and save us from writing that logic.
- **Selection-to-action context**: on every `onDidChangeCursorSelection`,
  recompute `{currentHunk, isMultiLine}` signals — the context menu
  renders off these. Don't try to compute at menu-open time; Monaco's
  selection can change between the prepare-menu and open-menu events.
- **No wrap on next/prev** — matches GK exactly, avoid adding chajá
  innovation.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `buildButton\("(next|previous)DiffButton"` — toolbar wiring.
- `updateDiffNavigatorCallbacks` — Redux hookup.
- `GoToNextAndPreviousDiffChangeCbsUpdated` — action creator.
- `this\.diffEditor\.getLineChanges\(\)` — per-selection hunk lookup.
- `getDiffLineInformationFor(Original|Modified)` — line-mapping helpers.
- `updateEntryInIndex` — back-end saga for stage/unstage.
