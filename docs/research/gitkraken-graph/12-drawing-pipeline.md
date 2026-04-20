# Drawing pipeline — component tree

Round 1 described the algorithmic SVG fragment builders. This document
captures the concrete React component hierarchy that mounts the graph and
the specific memoization boundaries.

## Root-to-leaf tree

Starting from the graph container:

```
<div className="graph-component" tabIndex={-1}
     onBlur/onMouseEnter/onMouseLeave/ref={graphComponentRef}>
├── <Dd>                              // header row
│   └── <ul direction="horizontal" ...DragDropContext>
│       └── <Md>*N                    // one per zone
│           ├── <div className="graph-header ...">
│           └── <nl resizeEdge="right">  // Resizable wrapper
└── <div className="graph-panels flex">  // horizontal flex of zones
    └── <oW>*N                        // per-zone virtualized column
        └── <Grid cellRangeRenderer={smartCellRangeRenderer}
                  cellRenderer={Y}
                  overscanRowCount={0}
                  rowHeight={28}
                  rowCount={processedRows.length} />
            └── for each visible row:
                <span data-column-name data-row-idx>
                  └── <cellRenderersByIds[zone]>(rowContext)
                      └── <Ud> (graph zone only)     // commit row wrapper
                          ├── <span className="graph-zone ...">
                          │   ├── <EdgeSvg>       // SVG with M/H/V/A paths
                          │   └── <Node>          // the commit circle
                          └── children (conflict icon, timeline indicator)
```

Zone-to-cellRenderer map (`So` object, ~offset 11913500):

| Zone                 | Renderer fn |
|----------------------|-------------|
| `refZone` (ui)       | `sv`        |
| `commitZone` (md)    | `se`        |
| `commitMessageZone`  | `nV`        |
| `commitAuthorZone`   | `nO`        |
| `commitDateTimeZone` | `nI`        |
| `commitShaZone`      | `nY`        |
| `changesZone`        | `nT`        |
| other (OU)           | `sS`        |

## Commit row wrapper `Ud`

Class `Ud extends PureComponent` (~offset 11812275). The graph-only branch
of the render tree. It receives ~30 props including `sha`, `type`,
`columnForColoring`, `isSelected`, `isHovering`, `isHighlighted`, `style`,
`zoneWidth`, `numGraphColumns`.

`PureComponent` gives it a cheap shallow-equality bailout. Critical for
hover/scroll performance because only the hovered row's props actually
change.

## className memoization — the `Bd` / `Gd` caches

Inside `Ud.render()` (pseudocode):

```
const Bd = {};  // module-level
const Gd = {};

function wrapperClass(type, isHovering) {
  const key = type + isHovering.toString();
  if (!Bd[key]) {
    Bd[key] = classnames(
      "graph-row-wrapper grow-3 height-100 graph-zone-column " +
      "min-width-0 pb3 pointer pt3 relative",
      type,
      { "is-hovering": isHovering }
    );
  }
  return Bd[key];
}

function innerClass(type, colForColoring, isHighlighted, isSelected,
                    numCols, isDimmed, hoveredRef, isMergeCommitDimmed,
                    dimSelectedCommit) {
  const key = `${type}${colForColoring}${isSelected}${isHighlighted}${numCols}` +
              `${isDimmed}${hoveredRef}${isMergeCommitDimmed}${dimSelectedCommit}`;
  if (!Gd[key]) {
    Gd[key] = classnames(
      "column-" + (colForColoring % numCols + 1),
      "graph-row height-100-percent flex",
      type,
      { "is-selected": isSelected },
      { "is-highlighted": isHighlighted },
      { "dimmed-row": (dimSelectedCommit && !isHighlighted)
                   || (isDimmed && (hoveredRef || isMergeCommitDimmed)) }
    );
  }
  return Gd[key];
}
```

The cache key for the inner row is a concatenation of **9 scalars**. The
closed universe of values is small (a few types, a handful of column
indices, booleans) — cache hit rate approaches 100% within a second of
usage. Strings are reused across **all** rows, not per row.

Combined with `PureComponent` on `Ud`, each render pass does:
1. Shallow prop compare — if props unchanged, skip.
2. If changed, recompute key → 99% cache hit → reuse pooled className.
3. Return an element with the same className reference React can diff
   cheaply.

## Re-render triggers

- **Hover**: `setAsCurrentlyHoveredGraphCommit(event, zone, sha, prevHovered)`
  dispatches to Redux. Selector returns new `currentlyHoveredCommitSha`.
  Only two rows re-render (old hovered + new hovered) because other rows'
  `isHovering` stays `false`.
- **Scroll**: visible-row range changes. Grid unmounts off-screen rows,
  mounts new ones. Already-visible rows have unchanged props → skip.
- **Selection**: same shape — `isSelected` changes on exactly the pair of
  old+new rows.
- **Ref drag**: all rows in the hovered ref's ancestor chain flip
  `isHighlighted`. Potentially many re-renders, but the className cache
  catches them.

## Layout / measure passes

No explicit measure pass. Row height is the fixed constant 28. Column width
is state-driven, not measured. Zone widths are read from Redux, not from
DOM. `ResizeObserver` (via `AutoSizer`) fires when the container changes —
that triggers Redux update of `graphWidth/graphHeight` which flow back as
props. No ping-pong layout thrashing.

## Chajá implications

- The `Bd`/`Gd` className-cache pattern **is the single most impactful
  optimization** and trivially portable to Solid. Two `Map<string, string>`
  at module scope. Do it.
- Keys must be built from a small finite domain — that's why they
  concatenate primitives, not objects. If you ever need an object-shaped
  key, hash it.
- In Solid, you don't need `PureComponent` — fine-grained reactivity means
  only the cells whose signals changed re-compute. But the className
  recomputation itself still benefits from the cache.
- Match the className taxonomy: `graph-row-wrapper`, `graph-row`,
  `column-N` (1-indexed!), `is-selected`, `is-highlighted`, `is-hovering`,
  `dimmed-row`. Doc 09 already relies on `column-N`.

## Source locations

- `Ud` class (commit row PureComponent): ~offset 11812275.
- `Bd` / `Gd` className caches: inline inside `Ud.render` at ~11813300.
- Zone-to-cellRenderer map `So`: ~11913500.
- Per-column virtualized container `oW`: factory used at ~11914000.
- Root graph render method: class near ~11913000, element at ~11914432.
