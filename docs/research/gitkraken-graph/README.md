# GitKraken commit graph — research notes

Reverse-engineering notes on how GitKraken Desktop renders its commit graph,
captured to inform Chajá's renderer design. **Not code** — algorithmic
pseudocode, concrete dimensions, and behavioral observations only.

## Licensing posture

GitKraken is proprietary software. These notes document **algorithms, heuristics,
and visual constants** observed by running their minified bundle through grep
and deobfuscation. They do not include verbatim source code.

- Algorithms / heuristics: not copyrightable in most jurisdictions. Fair game
  to reimplement from scratch in Chajá.
- Concrete dimensions (pixel values, color hex codes): facts. Fair game.
- Method names / property names: facts, used as grep anchors for reproduction.
- Minified code fragments: not copied here. If you need to verify a claim,
  re-grep the bundle yourself (paths below).

**Rule**: read these notes, then reimplement from scratch in your own style.
Do not paste anything from the GitKraken bundle into Chajá source.

## How this research was produced

Source: `/var/lib/flatpak/app/com.axosoft.GitKraken/current/active/files/extra/gitkraken/resources/app.asar`
(version 12.0.1, extracted to `/tmp/gk-asar/` with `@electron/asar`).

Primary file of interest: `src/render/static/entryPoints/main/render.bundle.js`
(~12 MB, webpack-minified but property names preserved for Redux/DOM).

Search strategy: targeted `grep` for preserved identifiers (`lane`, `column`,
`parentSha`, `pinnedBranchShas`, `refZone`, `dimmed-row`, etc.), then read
~20 lines of context around each hit to reconstruct the algorithm.

Two research rounds: see file order below.

## File index

| File | Topic | Round |
|---|---|---|
| [01-lane-allocator.md](01-lane-allocator.md) | Lane assignment algorithm (trunk pin + reservations + stealing) | 1 |
| [02-edge-rendering.md](02-edge-rendering.md) | Per-row SVG arc edges (not Bezier) | 1 |
| [03-topological-order.md](03-topological-order.md) | Sort delegated to `git log --topo-order --date-order` | 1 |
| [04-dimensions.md](04-dimensions.md) | Concrete pixel values (row height, column width, radii) | 2 |
| [05-trunk-pinning.md](05-trunk-pinning.md) | How the pinned trunk branch is selected | 2 |
| [06-ref-pills.md](06-ref-pills.md) | BRANCH/TAG column layout and overflow handling | 2 |
| [07-wip-row.md](07-wip-row.md) | Working-tree pseudo-row styling and dashed connector | 2 |
| [08-hover-dim.md](08-hover-dim.md) | Ref-hover dim with precomputed childRefs | 2 |
| [09-color-palette.md](09-color-palette.md) | 10-color CSS-var palette with modulo rotation | 2 |

## Chajá implementation status (2026-04-20)

What we already match:
- Topological sort (Kahn with committer_time desc) — equivalent behavior.
- Leftmost-free lane allocation — same root strategy.
- Separate WIP pseudo-row above the scroll — same idea, different implementation.

What we differ on (intentionally or by omission):
- Edges: we use cubic Bézier on WebGL; GitKraken uses SVG arcs. Aesthetic
  choice — Bézier is smoother, arcs are sharper / more GitKraken-like.
- No trunk pinning: when a pinned branch is unset we have no fallback; the
  lane assigner drifts.
- No reservation map: children don't pre-announce parent columns, so merged
  branches can land in suboptimal lanes.
- No column stealing: lanes drift rightward over long histories instead of
  compacting.
- Ref pills (BRANCH/TAG column) not yet implemented (#55 pending).
- Hover dim (#54), pulse/scroll (#72), WIP connector fix (#81) pending.
- Palette is close in spirit but not a 1:1 match.

Follow-up issues driven by this research are tracked in the project board
under label `area:ui` + `priority:high`/`medium`.
