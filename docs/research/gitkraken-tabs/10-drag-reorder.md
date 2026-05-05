# Drag-Reorder Tabs

GK uses **react-sortable-hoc** (bundled at `bundle:120548-121168`) to wrap the tab strip. Drag-end fires a `MOVE` op which the reducer applies via the same `arrayMove` utility. This is **issue #39** — keep it as its own GitHub issue rather than folding under #135. Code-wise it's small, but UX-wise it deserves its own PR + visual QA pass.

## Wiring (bundle:330246-330257)

```js
onSortStart: () => Ve(IsTabBeingDraggedUpdated(!0)),
onSortEnd: ({ oldIndex: at, newIndex: ct }) => {
    Ve(IsTabBeingDraggedUpdated(!1)),
    Ve(performTabOperation({
        type: Ea.tabOperationTypes.MOVE,
        oldIndex: at,
        newIndex: ct
    }))
},
```

Two events on the sortable container:
- **`onSortStart`**: flips `isTabBeingDragged` flag → CSS suppresses hover/click effects on sibling pills.
- **`onSortEnd`**: clears the flag + dispatches `MOVE`.

The drag-handle is the **entire pill** — no dedicated handle. `useDragHandle: false` on the SortableContainer. Pressing on a pill anywhere starts the drag.

## Reducer branch (bundle:2123-2137)

```js
case Oa.tabOperationTypes.MOVE: {
    const { newIndex: Ve, oldIndex: at } = An;
    if ("number" != typeof Ve || "number" != typeof at) {
        console.error(zn.INVALID_TAB_OPERATION), ur = !0;
        break
    }
    if (lodash.clamp(0, hr.tabs.length - 1, Ve) !== Ve ||
        lodash.clamp(0, hr.tabs.length - 1, at) !== at) {
        ur = !0;
        break
    }
    hr.tabs = arrayMove(hr.tabs, An.oldIndex, An.newIndex);
    break
}
```

Two validations:
1. Both indices are numbers (defensive; the saga always provides them).
2. Both indices are in-range (`0 <= idx <= tabs.length - 1`).

`arrayMove` is the same util used by react-sortable-hoc:

```js
function arrayMove(Ve, at, ct) {
    return (Ve = Ve.slice()).splice(ct < 0 ? Ve.length + ct : ct, 0,
                                    Ve.splice(at, 1)[0]), Ve
}
```

— a non-mutating insert-at-index. Port verbatim, it's 1 line.

## chajá port options

For sub-PR 8 (= #39), three viable libs:

| Lib | Pros | Cons |
|---|---|---|
| **`@thisbeyond/solid-dnd`** | Solid-native, well-maintained, ~5KB | Requires SortableProvider wiring; the API differs from react-sortable-hoc |
| **Hand-rolled `pointerdown` + `pointermove`** | No dep, full control | ~150 LOC; need to handle pointer capture, axis lock, hit testing |
| **HTML5 native `draggable="true"`** | Zero dep, browser-supported | Janky visuals (custom drag preview + drop zones), poor cross-browser feel |

**Recommendation**: hand-rolled. The tab strip is 1D (`axis: x`), no pointer-capture edge cases (the strip is always horizontal, no nesting), and chajá already follows this pattern for `GraphColumnResizer` (see `apps/chaja-app/src/components/CommitGraph/GraphColumnResizer.tsx`). The wins: no new dep, less bundle weight, no semver risk.

Sketch:

```ts
let startX = 0;
let draggedIndex = -1;
let pillWidths: number[] = [];

function onPointerDown(e: PointerEvent, index: number) {
  if (e.button !== 0) return;
  startX = e.clientX;
  draggedIndex = index;
  pillWidths = computePillWidths();
  setIsTabBeingDragged(true);
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (draggedIndex < 0) return;
  // translate the dragged pill by (e.clientX - startX)
  // detect target index by hit-testing against pill edges
}

function onPointerUp(e: PointerEvent) {
  const newIndex = computeTargetIndex(e.clientX);
  if (newIndex !== draggedIndex && newIndex >= 0) {
    void performTabOperation({ type: "MOVE", oldIndex: draggedIndex, newIndex });
  }
  draggedIndex = -1;
  setIsTabBeingDragged(false);
}
```

`computePillWidths` measures every pill's `getBoundingClientRect().width` once at drag start (so movement during drag doesn't trigger reflow). `computeTargetIndex` walks the cumulative widths until the cursor X falls inside a pill bounding box.

## CSS

The `is-being-dragged` class on the dragged pill should:
- Lift z-index to render above siblings.
- Apply a subtle shadow (matches GK's drag-preview).
- Translate by the drag delta via `transform: translateX(deltaX)`.

Sibling pills get `is-sibling-dragging` to suppress hover/click cursors and to subtly slide left/right via CSS `transition: transform 0.15s ease` as the dragged pill displaces them.

## Edge cases

1. **Drag past the `+` button**: clamped at `tabs.length - 1`. The `+` button is part of the sortable list in GK but tagged non-sortable; for chajá, exclude the `+` from the pointer hit-testing range.
2. **Drag past REPO_MANAGEMENT permanent tab**: same as `+` — permanent tabs are non-reorderable and live at the right edge. Hit-test only against transient pills.
3. **Single-pill strip**: drag is a no-op — no other pills to swap with.
4. **Concurrent CLOSE during drag**: GK's queue serializes — the MOVE op waits for any in-flight op. The chajá port using the Promise queue from doc 02 inherits the same guarantee.

## Cross-validation

Two claims worth re-grepping:

1. **`onSortStart` flips `isTabBeingDragged`** before any visual change — confirmed at bundle:330254-330256. The flag drives sibling-suppression CSS; if the chajá port omits this, sibling pills will show hover effects under the dragged pill, which surprises users.
2. **`useDragHandle: false`** — confirmed by the absence of a `useDragHandle` prop on the SortableContainer (the default is false). The whole pill is the handle. Don't add a dedicated drag-handle `:before` element.
