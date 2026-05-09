# Concrete dimensions

Pixel values observed in the bundle's `k()` factory (module 214 for base
constants, module 522 for CSS variables). Values are for **normal** density;
compact density roughly halves most of them.

## Row geometry

| Constant | Value (px) | Usage |
|---|---|---|
| `GRAPH_ROW_HEIGHT` (`yB`) | **28** | Outer row height, including padding |
| `GRAPH_ROW_INNER_HEIGHT` (`$0` / `lH`) | **22** | Inner content box height |
| `GRAPH_ROW_PADDING` (`ar`) | **3 + 3** | Top and bottom vertical padding |
| Commit zone margin top/bottom (`_b`, `kj`) | 3 / 3 | Additional inset for nodes |

So a commit row is: `[3px pad] [22px content] [3px pad]` = 28 px.

## Column (lane) geometry

| Constant | Value (px) |
|---|---|
| `COMMIT_COLUMN_WIDTH` | **22** |
| `COMMIT_ZONE_GUTTER_WIDTH` | **28** |
| `COMMIT_ZONE_LINE_WIDTH` (edge stroke) | **2** |

Lane center X: `gutter + col * columnWidth + columnWidth/2`
= `28 + col*22 + 11` pixels from the GRAPH cell's left edge.

Default supported columns: **10** (CSS var `--num-columns-supported: 10`).

## Node geometry

| Constant | Value (px) | Radius |
|---|---|---|
| `COMMIT_NODE_DIAMETER` | **22** | **11** |
| `COMMIT_MERGE_NODE_DIAMETER` | **12** | **6** |
| Avatar (on commit node) | 18 inner / 22 outer | — |

Merge nodes are visually smaller to differentiate them from regular commits
without adding icons.

## Arc geometry

| Constant | Value (px) |
|---|---|
| `COMMIT_ZONE_EDGE_ARC_RADIUS` (`nf`) | **11** |
| `COMMIT_ZONE_EDGE_ARC_PADDING` (`Oe`) | **3** |
| **Effective quarter-arc radius** (`nf - Oe`) | **8** |

An edge turning from vertical into horizontal (or vice versa) draws a
quarter-circle with r=8. Padding accounts for the stroke width so the arc's
visual edge lands on the column boundary.

## Compact mode

When the user toggles compact density, all dimensions collapse:

| | Normal | Compact |
|---|---|---|
| Line stroke | 2 | 1 |
| Gutter | 28 | 10 |
| Column width | 22 | 10 |
| Node diameter | 22 | 10 |
| Merge node diameter | 12 | 10 |

Compact mode is effectively GitKraken's "dense" view for quick scanning.

## Current Yryvu values (for comparison)

| Concept | GitKraken | Yryvu (today) | Gap |
|---|---|---|---|
| Row height | 28 | 24 | –4 |
| Lane / column width | 22 | 14 | –8 |
| Node radius | 11 | 5 | –6 |
| Merge node radius | 6 | (same as commit) | no differentiation |
| Edge stroke | 2 | 2 | ✓ |
| Arc radius | 8 | — (Bézier) | structural difference |
| Left gutter | 28 | ~0 | –28 |

Our graph is visually tight — everything smaller, closer together, no
differentiation between commit and merge nodes. A dimensions-only tuning
pass could ship independently of the algorithmic changes.

## Source locations

Bundle: `/tmp/gk-asar/src/render/static/entryPoints/main/render.bundle.js`.

Key symbols:
- `k()` — factory returning the dimension bundle.
- Module 214 — base constants (search for `yB`, `$0`, `lH`, `ar`, `nf`, `Oe`).
- Module 522 — CSS variable defaults (search for `--num-columns-supported`,
  `--graph-color-` prefix).
