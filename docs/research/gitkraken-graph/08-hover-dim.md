# Hover dim — "show only ancestors of this ref"

When the user hovers a ref pill, GitKraken dims every commit that is NOT an
ancestor of that ref. This is the reference for Chajá issue **#54** (dim
non-member commits on hover).

## Key insight: ancestors are precomputed, not traversed on hover

GitKraken does NOT walk the commit DAG on each hover event. During
`loadRowsbySha` (the row-loading pass), it builds a `childRefs` field on
every row:

```
row.childRefs = {
  heads:   Set<string>,   // head ref names whose row or descendants include this commit
  remotes: Set<string>,   // remote ref names ...
  tags:    Set<string>,   // tag ref names ...
}
```

Built by propagating from children upward in topological order:

```python
for row in topo_rows:
  for parent_sha in row.parents:
    parent = rows_by_sha[parent_sha]
    parent.child_refs.heads   |= row.heads_names   | row.child_refs.heads
    parent.child_refs.remotes |= row.remotes_names | row.child_refs.remotes
    parent.child_refs.tags    |= row.tags_names    | row.child_refs.tags
```

(Pseudocode; actual implementation uses Sets indexed by ref full name with
owner qualifiers.)

This is a single O(N + E) pass where N = commits, E = total parent edges.

## Hover handler

On each frame where a ref is hovered:

```python
def is_missing_hovered_ref_group(row_index):
  if highlighted_shas_present: return False
  probe_group = selected_commit.ref_groups[0] if dim_rows_of_selected_commit \
                else hovered_ref_group

  if row.has_no_refs or (row.has_only_tags and probe_group.type != TAG):
    source = row.child_refs
  else:
    source = row  # check the row's own refs first

  return not match_by_name_owner(source, probe_group)
```

Complexity per hover: **O(refs_in_row)** — typically 0–3 refs — times the
number of visible rows. At 200 visible rows × 1 ref average = ~200 set
lookups per hover. Essentially free.

The result drives a CSS class `dimmed-row` on the row wrapper. Unfound
dimmed-row CSS rule in the minified bundle, but theme `--text-dimmed` is
`rgba(255,255,255,0.2)` — likely applied as `opacity: 0.35` or a
color-dodge filter.

## Selection-driven dim

If `dimRowsOfSelectedCommit` is active (a setting — "Dim ancestors of
selected commit"), the probe group is the selected commit's first ref group
instead of the hovered one. Same evaluation function, different input.

## Gutter node opacity gradient (bonus finding)

Separate from hover dim: nodes near the edge of the horizontal scroll area
fade out via a gradient:

```
alpha = min_alpha + (1 - min_alpha) * clamp01(dist_from_edge / (gutter_width / 2))
```

where `min_alpha = 0.5`. Creates a soft fade-out as nodes scroll out of view
horizontally. Not driven by hover — purely a clip-to-gutter aesthetic.

## Chajá implementation plan

1. In `graph-core`, add `child_refs: ChildRefs` to `GraphRow`:
   ```rust
   pub struct ChildRefs {
       pub heads: HashSet<String>,
       pub remotes: HashSet<String>,
       pub tags: HashSet<String>,
   }
   ```

2. Compute `child_refs` during the topo walk (after the Kahn sort, before
   shipping to the front-end). One pass bottom-up, propagating sets.

3. On the front-end, attach hover handlers to ref pills (issue #54 / #55).
   When a pill is hovered, store `hoveredRefGroup` in state and the renderer
   iterates rows, applying `opacity: 0.35` to rows where
   `is_missing_hovered_ref_group` returns true.

4. Implementing as a WebGL uniform: pass a `dim_mask: Float32Array` keyed by
   visible row index (0 for "full opacity", 1 for "dimmed"). Fragment shader
   multiplies alpha accordingly. Cheap.

5. Gutter fade can be the same mask's second channel.

## Pulse and auto-scroll on click (bonus — for #72)

GitKraken on ref click calls `setScrollToSha(sha, scrollLeft)`. Alignment
(`auto` if visible, `center` if not) picked by function `U()`.

**No keyframe pulse animation was found in the bundle.** It's a plain scroll,
no visual pulse. So GitKraken's UX on ref click is: scroll + select. If
Chajá wants a pulse, that's our own innovation rather than mimicry.

## Source locations

Bundle: same file.

- `childRefs` — property name (multiple offsets, search for it directly).
- `loadRowsbySha` (offset ~11898186) — the walk that builds childRefs.
- `isMissingHoveredRefGroup` (offset ~11943394).
- `Gd` — row wrapper that applies `dimmed-row` class (offset ~11813100).
- `getNodeOpacityByColumn` (offset ~11884382) — gutter fade.
- `setScrollToSha` (offset ~11881890).
- `COMMIT_NODE_MIN_ALPHA` (`Td`) — 0.5.
