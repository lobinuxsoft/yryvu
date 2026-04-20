# WIP pseudo-row

When the working tree is dirty, GitKraken adds a pseudo-row above the HEAD
commit that represents the uncommitted changes. This is the reference for
Chajá issues **#81** (WIP connector clipping) and the WIP row styling we
already have.

## Geometry

- **Row height**: same as regular rows — 28 px outer, 22 px inner.
  GitKraken does NOT make WIP shorter or taller.
- **Column color**: always `column-1` (the second color in the palette —
  blue). Does NOT follow the HEAD commit's actual lane color.
  This means the WIP dashed node is always blue-ish regardless of which
  branch HEAD is on.

## Node

- Same node component as any non-commit row type. Type flag is `ba.bY`
  (the "workDir" pseudo-type).
- Tooltip text: localized from key `Graph-WorkInProgress`.
- **No dashed border on the circle itself** — GitKraken works around the
  fact that `stroke-dasharray` is ignored on SVG `<circle>` elements by
  keeping the node a solid circle and applying dashing only on the edge.

## Dashed connector — the key insight

The dashed line from the WIP node to the HEAD commit node below is drawn as
part of **the same SVG fragment** that draws the regular row edges, not as a
separate pseudo-element.

Mechanism:
- When the edge source node's type matches the predicate
  `!(type === commit || type === merge)` (i.e., workDir, stash, or any
  non-commit pseudo-type), the stroke for that edge gets
  `stroke-dasharray="2"` (normal density) or `"1"` (compact density).
- The edge still uses the same orthogonal path builder (`ec()`); only the
  dash attribute changes.

So the connector is a full-fledged SVG `<path>` inside the row SVG, and it
stays aligned with everything else because it's part of the same coordinate
system.

**Chajá bug (#81) root cause**: our WIP connector is a CSS `::after`
pseudo-element on a `<span>` that sits in a DOM flow outside the canvas. When
the canvas scrolls or renders over the connector's area, paint order hides
it.

**Chajá fix**: render the WIP row through the same renderer pipeline as
regular rows. When `dirty_file_count > 0`, synthesize a "virtual" GraphRow
at index -1 with type `WorkDir`, push it into the WebGL batch, and draw a
dashed stroke between its node and the HEAD node. No more DOM connector.

## Inline message editor

The WIP row carries an inline input for the pending commit message:

```
<div class="graph-zone-column pt3 pb3 ...">
  <NodeComponent type=WorkDir />
  <input class="work-dir-input" placeholder="..." />
  <summary>{N added}{N modified}{N deleted}{N renamed}</summary>
</div>
```

The input is the same one that appears in the commit panel on the right —
GitKraken keeps them synced via Redux. Our implementation in
`commit-graph__wip-input` already does this via the `commitMessage` signal.

## Chajá implementation (proposed for fixing #81 + matching GitKraken)

1. In `graph-core`, add a `RowKind` enum to `GraphRow`:
   ```rust
   pub enum RowKind { Commit, Merge, WorkDir, Stash }
   ```
   Existing rows default to `Commit` or `Merge` (from `is_merge`). WIP synthesized
   rows get `WorkDir`.

2. In the TS renderer, detect `kind !== Commit && kind !== Merge` and flip the
   edge stroke to dashed via a new attribute / uniform.

3. Move the WIP row rendering from the current CSS-only DOM approach into
   the WebGL pipeline. Position it as a virtual row above row 0 at
   `y = -rowHeight/2` (relative to the top of the scroll area) with a
   `rowIndex = -1`. Canvas stays sticky-top so the WIP stays visible as the
   user scrolls down (same as now).

4. The `<input>` editor stays as a DOM element overlaid on the canvas —
   just like the commit text rows are DOM elements.

## Source locations

Bundle: same file.

- `Cu` — WIP row container component (offset ~11825800).
- `nV` — WIP row renderer (offset ~11826719).
- `ba.bY` — the workDir node type enum value.
- `V=Ve=>!(Ve===ba.oB||Ve===ba.t$)` — the predicate that switches stroke to
  dashed (offset ~11595200). `ba.oB` is commit; `ba.t$` is merge.
