# Color palette

GitKraken's lane palette: **10 colors, assigned by column index with modulo
rotation**. No sha hashing, no branch-name hashing. Simple and themable.

## The 10 colors

From module 522 (CSS variable defaults):

| Index | CSS var | Hex | Approximate name |
|---|---|---|---|
| 0 | `--column-0-color` | `#15a0bf` | teal cyan |
| 1 | `--column-1-color` | `#0669f7` | blue (also used by WIP) |
| 2 | `--column-2-color` | `#8e00c2` | purple |
| 3 | `--column-3-color` | `#c517b6` | magenta |
| 4 | `--column-4-color` | `#d90171` | pink |
| 5 | `--column-5-color` | `#cd0101` | red |
| 6 | `--column-6-color` | `#f25d2e` | orange |
| 7 | `--column-7-color` | `#f2ca33` | yellow |
| 8 | `--column-8-color` | `#7bd938` | green |
| 9 | `--column-9-color` | `#2ece9d` | mint |

Duplicated as `--graph-color-0..9` with the same hex values, plus derived
variants:
- `--graph-color-N-f10` — 10% alpha.
- `--graph-color-N-f50` — 50% alpha.
- `--graph-color-N-bg15`, `-bg25`, `-bg45`, `-bg50` — pre-blended backgrounds
  (commit row stripe, selection, hover, etc.).

## Assignment rule

```python
def color_for_column(col, num_graph_columns):
  return css_var(f"--column-{col % num_graph_columns}-color")
```

Column index → color index, one-to-one up to 10; beyond that, wrap.

No sha-based color (like GitHub does): a branch that lives on column 3 is
always magenta, regardless of which sha is there. A branch that moves to
column 3 (after column stealing) also becomes magenta. This is why you
sometimes see a branch appear to "change color" in GitKraken — it really did,
because its column changed.

## 1-indexed class names

Rows are given classes `column-1` through `column-10` (1-indexed despite the
0-indexed CSS vars). Mapping:

```
row.class = `column-${(col % 10) + 1}`
row.color = var(--column-${col % 10}-color)
```

The off-by-one is purely cosmetic — the CSS selectors use `column-1..10` while
the variables use `column-0..9`. Carry the index correctly when porting.

## WIP override

The WIP pseudo-row is **always column 1 (blue)**, regardless of the HEAD
commit's actual lane (see `07-wip-row.md`). This gives a consistent visual
anchor for the "uncommitted changes" concept.

## Yryvu current state

File: `apps/yryvu-app/src/components/CommitGraph/palette.ts`

We have an RGB palette (array of `[r, g, b]` triples) passed as a WebGL
uniform. Assignment is by `color_idx` which the `LaneAssigner` picks at
lane-claim time (via `color_idx_for(sha, palette_size)` which hashes the
sha — different from GitKraken's pure column-index strategy).

To match GitKraken:

1. Replace `color_idx_for(sha, ...)` with `color_idx_for_column(col, ...)`
   — just `col % palette_size`.
2. Update palette hex values to match (or adopt a derivative scheme).
3. Add CSS custom properties `--column-0-color`..`--column-9-color` so themes
   can override them at the CSS layer (same as GitKraken's themable pattern).
4. Generate `--graph-color-N-f10`, `-f50`, `-bgN` variants in CSS for ref pills,
   row selection highlights, etc.

## Yryvu opportunity: themability

Mirror GitKraken's contract — 10 CSS vars for lane colors, derivative alpha
variants — so custom themes (issue #27 `feat(themes)`) can override them.

## Source locations

Bundle: same file.

- Module 522 — CSS variable defaults (grep for `--column-0-color`,
  `--graph-color-`).
- `$6(n)` (offset ~11931000) — returns the CSS var name for column n.
- `getColumnColorByColumn` (offset ~11902715) — resolver.
- Module 686 — palette resolution helpers.
