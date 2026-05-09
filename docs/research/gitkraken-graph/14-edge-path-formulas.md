# Edge path formulas — exact M/H/V/A sequences

Doc 02 described the orthogonal-plus-arc algorithm at a high level: edges
travel straight along columns and rows, turning through fixed-radius
quarter arcs at transitions. This file nails down the **exact sequence of
SVG path commands** emitted per transition class, the sign conventions,
and the two direction tables used to pick the correct arc sweep.

## Builder anatomy

The builder lives in `render.bundle.js` near offset 11596137 (function
`ec` in the minified output — receives a polyline-style list of
`{col, row, kind}` waypoints and returns an SVG `d` string). It reads
three constants from the theme/layout module `_a`:

- `_a.nf` — column pitch in px (column stride).
- `_a.Oe` — half the lane-to-lane gap (arc padding).
- `yo = _a.nf - _a.Oe` (defined just before `ec`). With the default
  layout `_a.nf = 20` and `_a.Oe = 12`, so **`yo = 8` px**. That is the
  arc radius used in every `A` command.

Two lookup tables steer the sweep flag and the sign of the arc end-point
offset:

- `uo` — maps the **incoming axis direction** (down / up / left / right,
  encoded as 0..3) to the SVG arc `sweep-flag` (`0` = CCW, `1` = CW).
  Minified equivalent of a dictionary like
  `{ down_then_right: 0, down_then_left: 1, up_then_right: 1, up_then_left: 0, ... }`.
- `go` — maps the same direction pair to the **sign tuple `(dx, dy)`**
  applied to the arc end coordinate relative to the corner pivot.
  In practice `go[k] = [±yo, ±yo]` with the sign chosen so the arc lands
  exactly `yo` px past the corner on the outgoing axis.

The literal template that appears inside `ec` is the string
`"A " + yo + " " + yo + " 0 0 " + sweep + " "` — i.e. radii equal,
x-axis-rotation `0`, large-arc-flag `0`, variable sweep.

A column-`c` at row-`r` resolves to screen coordinates `(cx, cy)` via
`cx = originX + c * _a.nf` and `cy = originY + r * rowHeight`.

## Per-case command sequences

All paths below assume **+x = right, +y = down** (SVG user-space).
`r = yo = 8`. `C(c, r)` abbreviates the cell center.

### 1. Passing-through vertical (same column, no events)

The edge enters the row at `C(c, prevR)` and exits at `C(c, nextR)` with
no bends.

```
M  cx,  prevY
V  nextY
```

No arcs, no horizontal offset. `sweep` / `go` unused. This is the hot
path — doc 11 notes it is emitted by the draw-list builder as a single
straight stroke coalesced per contiguous vertical run.

### 2. Starting parent in a new column

The child sits at `C(cChild, rChild)` and the parent the edge points at
lives at column `cParent` one row down (`rChild + 1`). Direction:
down then horizontal (left if `cParent < cChild`, right otherwise).
Let `s = sign(cParent - cChild)` ∈ {−1, +1}.

```
M  cxChild, cyChild                          ; start at child center
V  cyParent − r                              ; descend to just above the corner
A  r r 0 0 sweep   cxChild + s*r, cyParent   ; quarter arc into the horizontal axis
H  cxParent                                  ; straight to the parent column
```

`sweep = uo[down_then_right]` when `s = +1`, else `uo[down_then_left]`.
`go` supplies the `(s*r, +r)` offset consumed implicitly by the `A`
end-point expression above.

### 3. Ending at parent (incoming edge from a column to the side)

The parent node absorbs an edge that arrives on its row from column
`cFrom` with `s = sign(cParent - cFrom)`. The last two commands of the
path are:

```
H  cxParent − s*r                            ; horizontal run stops one radius shy
A  r r 0 0 sweep   cxParent, cyParent        ; arc into vertical axis, lands at parent center
```

`sweep = uo[right_then_up]` when the incoming axis was `right` and the
parent is above (`s = +1`, vertical direction up), mirrored for the
other three quadrants. The arc lands exactly at `C(cParent, rParent)`,
so no final `V` or `M` is needed — the subpath terminates on the node
center, which the renderer knows not to stroke over because the node
circle is painted **after** the edge layer (doc 11 pipeline step 4
follows step 3).

### 4. Merge commit's extra-parent edge

A merge commit has two parent pointers. The primary parent shares the
merge's column (case 1 or 3 depending on distance); the **second
parent** requires a full L-shape and is emitted as a separate subpath
so that the SVG stroke doesn't self-intersect under dashed styling.

```
M  cxMerge, cyMerge
V  cyParent2 − r
A  r r 0 0 sweep1  cxMerge + s*r, cyParent2
H  cxParent2 − s*r
A  r r 0 0 sweep2  cxParent2, cyParent2
```

Two arcs, both of radius `r`. `sweep1` from `uo[down_then_horizontal(s)]`,
`sweep2` from `uo[horizontal(s)_then_up]` (the edge ends at the second
parent, so the tail axis is **up** into the parent node center —
except the second `A` lands flush on the row, same as case 3).
Because both arcs belong to a single `d` attribute, the renderer can
apply a single `stroke` pass, and the line cap at the merge-commit end
is controlled by the shared `stroke-linejoin: round` inherited from the
`<g>` parent.

### 5. WIP dashed stroke

The WIP edge uses the **identical command sequence** as cases 1–4
depending on its geometry. The only difference is at the style level:
the `<path>` element receives `stroke-dasharray="4 3"` (the two
literals visible in the bundle near the WIP style object, alongside
the `opacity: 0.7` from doc 07). The dash pattern is expressed in
**user-space** px, not path-length normalized, so dashes are continuous
across the `A` segments because quarter arcs of radius 8 and 90° have
an arc length of `π * r / 2 ≈ 12.57 px` — the dash pattern `4 on, 3 off`
divides evenly enough that the join with straight segments is visually
clean.

## Yryvu implications

When porting to Rust + SolidJS, the command emitter should be a pure
function `fn build_edge(waypoints: &[Waypoint]) -> String` living next
to the draw-list builder (doc 11). The two lookup tables must be
constants:

```rust
const ARC_RADIUS: f32 = 8.0;  // mirrors GK's yo
// sweep flag: 0 = CCW, 1 = CW
const SWEEP: [u8; 8] = [ /* 4 incoming x 2 outgoing directions */ ];
const OFFSET_SIGN: [(i8, i8); 8] = [ /* dx, dy per transition */ ];
```

Three invariants to enforce:

1. **Arc radius must equal column-pitch minus arc-padding.** If a theme
   tweak widens the column pitch without updating `arcPadding`, arcs
   overshoot the column center. Assert
   `ARC_RADIUS > 0 && ARC_RADIUS < column_pitch / 2`.
2. **The sweep table is symmetric under axis negation.** Unit tests
   should verify `SWEEP[down_then_right] != SWEEP[down_then_left]` and
   the other three mirror pairs — that single check catches 90% of
   "edges curve the wrong way" bugs.
3. **Dash pattern must be user-space, not path-length.** SVG's default
   behavior matches GK's. In a `<canvas>` port,
   `CanvasRenderingContext2D.setLineDash()` already uses user space,
   so no conversion is needed.

The minimum viable port can skip the two-arc merge path of case 4 at
first and render merge second-parent edges as two separate single-arc
subpaths; slightly uglier under dashed styling but visually correct
for solid strokes.

## Source locations

- `render.bundle.js` ~11596137 — function `ec`, the SVG path builder.
  Contains the `A ${yo} ${yo} 0 0 0 ` / `A ${yo} ${yo} 0 0 1 `
  literal templates.
- Same file, ~80 lines earlier — `const yo = _a.nf - _a.Oe;` (arc
  radius constant).
- `uo` — small array/object literal above `ec`, 8 entries mapping
  direction pair → sweep flag.
- `go` — companion table, 8 entries of `[±yo, ±yo]` offsets.
- `So` — helper that receives `{fromDir, toDir}` and returns the
  `(sweep, dx, dy)` triple by indexing `uo` and `go`.
- WIP dash-array literal `"4 3"` — in the style object near the
  `opacity: 0.7` WIP block (see doc 07 source locations).
