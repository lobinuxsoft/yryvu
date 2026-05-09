# Drag & drop refs — GitKraken's signature gesture

GitKraken's flagship demo: grab a branch pill and drop it onto another
branch to trigger merge / rebase / reset / fast-forward. The bundle
confirms that the graph is the DnD hub, but **the graph does NOT use
`react-dnd` for its refs** (only collapsible sidebar panels do). Graph
refs use HTML5 native `dragstart` / `dragover` / `drop` mapped through
React's synthetic event table.

The real `react-dnd` integration (with `canDrop`, `hover`, `drop`
specification validated by `dt(dn.indexOf(at)>-1, 'Expected the drop
target...')`) is reserved for `CollapsiblePanel` with props
`dndData`, `dndDirection`, `onBeginDrag`, `onDrop`, `onEndDrag`,
`onHover`, `isDraggable` — used to reorder workspace panels,
favorite repos, and sidebar sections. Not for refs.

## Drag sources & drop targets

Drag sources:
- **Ref pills in graph** (symbol `nK`, with `targetRef:this.popoverTargetRef`,
  `refNodeHovered` state). Covers branch / tag / remote pills.
- **CollapsiblePanel** (sidebar panels, favorite repos, workspaces) —
  reorder only, irrelevant to graph operations.
- **Pending Interactive Rebase rows** — separate system, see doc 19.

Valid drop targets:
- Another ref pill in the graph.
- A commit row in the graph (drop on the sha).
- A panel container (only for panel drag).

## Action set

Actions discovered in context menus, presumed reused in the post-drop
popup (`ContextMenu-CheckoutBranch`, `ContextMenu-MergeBranch`,
`ContextMenu-RebaseBranch` appear as translatable labels).

`GitMergeStrategy` enum:
- `MergeCommit`
- `Rebase`
- `RebaseThenMergeCommit`
- `FastForward`
- `Squash`

These are exactly the options typically offered by the post-drop popup.

## Algorithm (pseudocode)

```
on dragStart(refPill):
    payload = { type: REF, fullName, sha, isBranch, isRemote, isTag }
    setDragImage(ghostPill)

on dragOver(target):
    if target.type == REF and isMergeFastForwardable(payload, target):
        cursor = "merge-ff-allowed"
    else if isCheckedOut(target):
        cursor = "merge-allowed"
    else:
        cursor = "no-drop"

on drop(target):
    actions = []
    if target.type == REF:
        actions += MergeBranchInto(payload -> target)
        if isMergeFastForwardable: actions += FastForwardTo(target)
        actions += RebaseBranchOnto(payload, target)
    if target.type == COMMIT:
        actions += ResetTo(soft|mixed|hard)
        actions += CherryPickHere
        actions += CreateBranchHere
    showActionMenuPopup(actions)
```

`isMergeFastForwardable` is a real saga (`isMergeFastForwardableSaga`)
that calls `nodegit.Reference.lookup` and compares against
`Merge.ANALYSIS.FASTFORWARD`. That's why the cursor changes live during
the hover without waiting for the drop.

## Visual feedback

- **Ghost**: the pill renders at the floating position (handled by the
  HTML5 `dragImage`).
- **Target highlight**: `refNodeHovered` in Redux marks the ref under
  the pointer. The target pill applies a hover class.
- **Invalid cursor**: the `dragOver` handler conditionally skips
  `preventDefault()`; without it, the browser shows the "no drop"
  cursor.
- **Modifier keys (Shift / Alt / Ctrl)**: the bundle exposes
  confirmations like `MergeRequiresStashAndCheckoutPrompt` and
  `RebaseRequiresStashAndCheckout` before acting; no shortcut that
  skips the action menu was found. The default action appears to be
  "merge into current" when the target is HEAD.

## Yryvu implications

- **Don't couple DnD to the DOM layer directly.** SolidJS lacks a
  mature `react-dnd` equivalent. Separate a `DragController` (logic)
  from the `DragView` (DOM events). This makes keyboard / pointer
  fallbacks feasible and tests simpler.
- **Model the payload as a discriminated union**:
  `RefDragPayload | CommitDragPayload | StashDragPayload`. The action
  resolver becomes a pure `(source, target) -> Action[]` table.
- **The post-drop menu is a secondary view**, not part of the DnD
  machinery itself. Keep it a regular context menu component so it
  can also be triggered without drag (right-click).
- **Keyboard accessibility** — GitKraken's gesture is mouse-only.
  Yryvu should offer an equivalent keyboard flow (e.g. select source
  ref with space, move focus, press enter) so DnD is not the only path
  to merge/rebase/cherry-pick.

## Source locations

- `/tmp/gk-asar/src/render/static/entryPoints/main/render.bundle.js`
- Symbols: `CollapsiblePanel`, `dndData`, `dndDirection`, `onBeginDrag`,
  `onDrop`, `onEndDrag`, `onHover`, `canDrop`, `canDrag`,
  `refNodeHovered`, `popoverTargetRef`, `nK` (ref node component),
  `GitMergeStrategy`, `isMergeFastForwardable`,
  `isMergeFastForwardableSaga`, `Merge.ANALYSIS.FASTFORWARD`.
- Native event constants: `DRAG_START="dragstart"`,
  `DRAG_OVER="dragover"`, `DROP="drop"`, `DRAG_END="dragend"`.
- react-dnd validator string: `'Expected the drop target specification
  to only have some of the following keys: %s'`.
