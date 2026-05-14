# Node overlays — decorations on commit circles

Each commit in the graph is primarily a **lane-colored circle**
(doc 09 for color, doc 04 for radius). On top of that base shape,
GitKraken composes up to six overlay layers that convey commit
state, identity, and interaction. Doc 04 mentioned avatars briefly;
this file catalogs all overlays, their z-order, and their trigger
conditions.

## Compositor

The overlay compositor is the function `NodeIcon` (offset ~10842000),
a React component that takes `{commit, state, hovered, selected}` and
returns an SVG `<g>` with children stacked in a deterministic order.
The ordering corresponds to SVG paint order, so later siblings sit
on top.

Z-order (bottom to top):

1. Lane circle (`<circle>` with `fill: laneColor`, `r: nodeRadius`).
2. Merge-commit distinction (inner fill swap for merge commits).
3. Avatar overlay (author photo, circular-clipped).
4. Conflict indicator (warning triangle on WIP-with-conflicts).
5. PR attribution icon (bottom-right mini badge).
6. Tag star icon (upper-right mini badge).
7. Selection ring (stroke-only circle, outside the node).
8. Hover halo (soft-edged outer glow).
9. Animation flash (transient, only on specific events).

## Overlay catalogue

### 1. Merge-commit visual distinction

Doc 04 noted that merge commits render at a **reduced radius**
(roughly 60 % of a normal commit's radius — the constant `0.6` or
`_a.Mr` appears next to the node radius calc — our research recorded
6 vs 11). Beyond size, merge commits also **invert fill and stroke**:
instead of `fill: laneColor, stroke: none`, they use
`fill: background, stroke: laneColor, stroke-width: 1.5`. That
produces a hollow donut look that reads as "not a content-carrying
commit."

Regular commits: solid disc. Merge commits: ring. Initial commits
(no parent): solid disc with a subtle 1 px darker outline (constant
`#00000022` in the palette block near `_a.Nr`).

### 2. Avatar overlay

When `commit.author.avatarUrl` is present and the row's vertical
budget ≥ 18 px, `avatarOverlay` renders. It is an SVG `<image>`
clipped by a `<clipPath>` referencing a circle slightly smaller than
the node (radius = `nodeRadius - 1`, leaving a 1 px gap so the lane
color rings the avatar like a frame).

The avatar URL is resolved through `avatarCache` (offset ~10836400),
which:

- Normalizes Gravatar / GitHub URLs to a single canonical form.
- LRU-caches blob URLs (max 512 entries).
- Falls back to an **initials SVG** generated in-code if the network
  fetch fails — `drawInitialsBadge(firstChar, lastChar, colorFromHash)`.

Merge commits **skip the avatar** entirely (the author of a merge
is usually a bot or a cherry-pick of someone else's work; GK's
product decision is to keep merges visually minimal).

### 3. Conflict indicator

Triggered only when the row represents the WIP commit (doc 07)
**and** the repo is in a conflicted state
(`state.repo.conflictCount > 0`). Rendered as a small warning-triangle
glyph positioned top-right of the node at offset
`(+nodeRadius*0.7, -nodeRadius*0.7)`, fill `#e74c3c` (the red literal
in the palette near the other state colors).

Size: 10 × 10 px. Drawn via a path `M 0 0 L 10 0 L 5 8.66 Z` with an
exclamation-mark path on top. Does not scale with node radius —
conflict must be loud.

Subtle detail: when the WIP has conflicts, doc 07's opacity = 0.7 is
**not applied** to this indicator. The compositor explicitly wraps
the conflict icon in a `<g opacity="1">` to override inheritance.
Visual priority of "you have conflicts" trumps the dimming.

### 4. PR attribution icon

Shown on commits that are the **tip of a branch with an open pull
request**. The `prAttribution` selector (~10849100) cross-references
`state.refs.byCommit` with `state.pullRequests.byBranch`. Rendered as
a 10 × 10 px PR glyph (source-control-icon with a circle-dot mark) at
offset `(+nodeRadius*0.7, +nodeRadius*0.7)` — bottom-right,
diagonally opposed to the tag star so they don't clash.

Color follows PR state:

- Open: `#3fb950` (green).
- Draft: `#8b949e` (gray).
- Merged: `#8957e5` (purple).
- Closed: `#da3633` (red).

These literals are recognizable as GitHub's PR status colors —
GK mirrors the platform's palette to make the glance-meaning transfer
instant.

### 5. Tag star icon

If the commit has at least one annotated tag **and** the user has
enabled "show tag stars on nodes" (setting `graph.showTagStars`,
default on), a 10 × 10 filled star renders at offset
`(+nodeRadius*0.7, -nodeRadius*0.7)`.

If both conflict and tag-star would occupy the same slot,
**conflict wins** — the compositor checks the conflict flag first
and short-circuits the tag-star render. That is the only overlay
collision handled explicitly; all others have disjoint positions
by design.

### 6. Selection ring

When `state.graph.selectedOid === commit.oid`, a stroke-only circle
renders at radius `nodeRadius + 3` with `stroke-width: 2` and
`stroke: accentColor` (theme-provided, `_a.Bi` in the bundle —
defaults to `#0969da`-ish blue). No fill.

The ring is **outside** the node so it never occludes the avatar.
Implemented as a sibling `<circle>`, not a CSS `outline`, because
SVG elements don't honor outline reliably across browsers.

Multi-select (Ctrl/Cmd+click) renders the same ring on every selected
commit — no distinction between "primary" and "additional" selection
in the ring style.

### 7. Hover halo

On `onCommitHover`, a halo renders at radius `nodeRadius + 5` with
`fill: laneColor` and `opacity: 0.15`, **below** the node circle —
physically the halo's `<circle>` element appears earlier in the DOM
than the lane circle, so paint order produces the outer-glow effect.

Hover also triggers the **dim-unrelated-commits** behavior from
doc 08 — the halo + dim combination creates the strong focus effect.

Transition: the halo's `opacity` is CSS-transitioned over `120 ms
ease-out` both on appear and disappear. No transition on the other
overlays, so the effect is specifically "this node is being pointed
at" rather than "something changed."

### 8. Animation flash

Two commit-level animations exist, both implemented as CSS
`@keyframes` applied to the node's outer `<g>`:

- **`commitCreated` pulse** — when the user authors a commit and the
  new oid shows up in the graph for the first time, the node pulses
  scale `1.0 → 1.25 → 1.0` over `400 ms ease-in-out`. Runs once.
- **`commitHighlight` flash** — when navigating to a commit, that
  commit's lane-color opacity flashes `1.0 → 0.3 → 1.0` over
  `600 ms`, drawing the eye. Also fires on "Go to commit" from the
  context menu.

Both animations are mounted via a one-shot class that's removed on
`animationend` — nothing special in the state store. The
`pulseAnimation` keyframe literal is visible in the bundle near
offset ~11020000.

Merge commits and the WIP commit do **not** animate on creation.
Only real content commits.

## Yryvu implications

SolidJS port should implement overlays as a **composable list of
optional render functions** rather than a monolithic `NodeIcon`
component:

```ts
const overlays: NodeOverlay[] = [
  mergeDistinction,    // swaps fill/stroke
  avatar,              // if url && row.height >= 18
  conflict,            // if WIP && conflicts
  prAttribution,       // if has open PR
  tagStar,             // if tags && settings.showTagStars
  selectionRing,       // if selected
  hoverHalo,           // if hovered
];
```

Each overlay is a pure `(commit, state) => JSXElement | null`. The
compositor maps over the list and filters nulls. Three wins:

1. **Adding a new overlay** (e.g. CI build status — a feature GK
   lacks) requires appending to the array, not editing a big switch.
2. **Conflict priority** (conflict over tag-star) is expressed as
   list order — whichever appears first renders first, and the
   tag-star renderer checks for the conflict flag and bails.
3. **Z-order** is literal array order, the most readable encoding.

Accessibility concern GK doesn't handle: the PR-state color is the
only cue for PR status on screen. Yryvu should add `<title>`
children (SVG's tooltip mechanism) on every overlay so screen
readers and keyboard hovers can discriminate "open PR" from
"draft PR" without relying on 2 px of color.

Performance note: the avatar cache is the single most expensive
overlay. Yryvu should key it on `email` (Gravatar) or
`username@host` (GitHub/GitLab) rather than URL — URLs change when
Gravatar rotates defaults, causing cache misses that hit the network
on every repo reopen. 512 entries is reasonable; go higher only if
profiling shows avatar load is a real bottleneck.

Do **not** port the `commitCreated` pulse at 1.25 scale — it's a
bit loud. A 1.10 scale over 300 ms reads as "something new" without
being distracting.

## Source locations

- `render.bundle.js` ~10842000 — `NodeIcon` component, the overlay
  compositor.
- ~10836400 — `avatarCache` LRU implementation and
  `drawInitialsBadge` fallback.
- ~10844200 — `conflictIcon` render function and the `#e74c3c`
  literal.
- ~10849100 — `prAttribution` selector cross-referencing refs and PRs.
- ~10851600 — PR state color literals (`#3fb950`, `#8b949e`,
  `#8957e5`, `#da3633`).
- ~10854800 — `tagStar` render function and the collision check
  against conflict.
- ~10858300 — `selectedRing` render, reads `state.graph.selectedOid`.
- ~10862100 — `hoverHalo` render, paired with the `120 ms` CSS
  transition literal.
- ~11020000 — `@keyframes pulse` and `@keyframes highlight`
  literals, plus the one-shot class-removal handler on
  `animationend`.
- Merge-commit distinction: the `0.6` or `_a.Mr` radius-multiplier
  constant lives next to the node-radius definition referenced by
  doc 04.
