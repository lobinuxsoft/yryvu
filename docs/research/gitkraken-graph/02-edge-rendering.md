# Edge rendering

GitKraken draws edges as **orthogonal SVG paths with quarter-circle arcs**, not
Bézier curves. Each row produces its own small SVG fragment (one per row in the
visible viewport). No canvas, no WebGL.

## Per-row SVG strategy

Each row emits a data-URI SVG mounted as a CSS `background-image` on an
absolutely-positioned `<div>`:

```
<div style="background: url('data:image/svg+xml;...<svg>...<path d='M ... H ... A ... V ...'/>...</svg>')">
  ... row content (pill, node, commit text) ...
</div>
```

Memoization caches identical fragments by geometry + type, so repeated rows
(common case: lane continuation with no events) serialize only once and reuse.

## Edge state machine

Each row contributes three kinds of edges, computed from the previous row's
edge map:

- **Starting edge**: an edge that originates at the current row (this row is a
  branch tip or has a parent on a new column).
- **Passing-through edge**: a lane that was active before this row and remains
  active after (no events — just a vertical stroke).
- **Ending edge**: an edge whose target sha matches the current row (this row
  is the parent being reached).

Computed as:

```python
def edges_for_row(cur_row, prev_edges):
  out = {}
  for col, prev in prev_edges.items():
    live = prev.pass_through if prev.pass_through and not filtered(prev.pass_through.type) \
           else prev.starting if prev.starting and not filtered(prev.starting.type) \
           else prev.pass_through or prev.starting
    if live is None:
      continue
    if live.parent_sha == cur_row.sha:
      out[col] = Entry(ending=live)
    else:
      out[col] = Entry(pass_through=live)
  return out
```

Starting edges are layered on top: one for the first parent at the current
commit's column, plus one per extra parent at its reserved column.

## Path geometry

Every edge segment within a row is built from three straight runs joined by
two quarter-circle arcs:

```
M start_x start_y
  H turn_x_1     (horizontal run)   [or V turn_y_1]
A r r 0 0 direction end_x_1 end_y_1 (quarter-circle corner)
  V turn_y_2     (vertical run)     [or H turn_x_2]
A r r 0 0 direction end_x_2 end_y_2 (second corner)
  ... (final H or V to target)
```

Corner geometry is parameterized by `r = arcRadius - arcPadding` (= 8 px in
normal density — see `04-dimensions.md`). Direction flags (CW vs CCW arcs)
are picked from four lookup tables keyed by the turn angle (0°, 90°, 180°,
270°).

## Path types

- **Straight vertical pass-through**: `M x y V y+rowHeight`. Single command.
- **Starting-parent-in-new-column**: horizontal run then arc then vertical
  down to next row. Child row's bottom half.
- **Ending-at-parent**: vertical run then arc then horizontal into parent's
  column. Parent row's top half.
- **Merge commit's second-parent edge**: starts at the merge commit node,
  arcs out to the extra parent's reserved column, runs vertical, arcs back
  at the parent row.

## Stroke and dash

- Solid strokes for regular commit edges (`stroke-dasharray` absent).
- Dashed strokes for WIP / stash / non-commit node types. `strokeDasharray = 2`
  in normal density, `1` in compact. Applied conditionally based on the
  source node's type (pseudo types like `WORKDIR`, `STASH`).
- Circle nodes never get dashed borders (stroke-dasharray is ignored on
  `<circle>` — GitKraken works around this by putting dashed styles only on
  path/line elements).

## Caches

Six memoization caches seen in the bundle:
- `Ba[column]` — precomputed center-x per column.
- `No`, `Co`, `Io`, `wo`, `vo` — serialized path fragments keyed by
  (edge type, column, compact-mode).

For Yryvu with SolidJS these map naturally to `createMemo` keyed by the same
tuples.

## Rendering order (within a row)

1. Backgrounds (row stripe, selection highlight).
2. Edges (SVG via CSS background-image).
3. Node (commit dot or merge dot, DOM `<circle>` wrapped in an element).
4. Avatar (overlaid on node for commits with authors).
5. Ref pills (DOM elements, absolutely positioned in the BRANCH/TAG cell).
6. Message text (sha + summary + author).

Z-order: nodes paint over edges; ref pills paint over nodes; messages in their
own grid cell. No `z-index` gymnastics — it comes from DOM order.

## Yryvu implications

Our renderer uses WebGL (ogl) with Bézier curves. Moving to SVG arcs would be
a substantial rewrite, but would:

- Match GitKraken's visual identity (sharper, grid-like look).
- Eliminate the WebGL antialiasing complexity — SVG strokes AA for free.
- Per-row memoization fits Solid's reactivity model perfectly.
- Losing: faster redraw on large repos (WebGL shines at 10k+ commits).

**Verdict**: keep WebGL as our default but document SVG arcs as an alternative
render mode we could offer (issue candidate for a future theme / density
toggle). Meanwhile, the per-row edge state machine above is directly
applicable to our renderer regardless of draw technology.

## Source locations

Bundle: same file.

Key symbols:
- `getEndingAndPassThroughEdgesByColumnFromPrevRow`
- `getStartingEdgesByColumn`
- `getFinalEdgeStateForGraphAndRow`
- `ec()` — SVG builder.
- `yo`, `So`, `uo`, `go` — arc radius constants and direction tables.
