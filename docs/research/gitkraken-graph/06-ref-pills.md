# Ref pills (BRANCH/TAG column)

The left column in GitKraken's graph carries branch / tag / head pills per
commit. This is the primary reference for Yryvu issue **#55**.

## Pill anatomy

Each pill is a flex container with this layout:

```
[ annotation ]  [ icons (L) ]  [ name ]  [ icons (R) ]  [ upstream ]  [ hide-btn ]
```

- **annotation**: checkmark (for the checked-out branch) or pin icon (for the
  pinned branch). Takes priority over the name, sits at the far left.
- **icons (left)**: ref-type icon (head / remote / tag / worktree) with
  optional remote-host avatar overlay (GitHub, GitLab, etc.).
- **name**: the ref's short name.
- **icons (right)**: pull-request badge, upstream-ahead / upstream-behind
  indicators.
- **upstream indicator**: arrows showing ahead/behind counts vs the tracked
  remote.
- **hide-btn**: visible on hover only; clicking hides that ref from the graph.
  Omitted if `!enableShowHideRefsOptions || hasActive`.

Outer container CSS class `ref-node`, with modifiers:
- `has-active` (at least one pill in this group is the active ref)
- `dim-ref` (reduced opacity — filter state or hover dim)
- `is-active` (this specific pill is the active ref)

Pill height: **22 px** (matches row inner height).

## Ref kind → icon mapping

From `getExternalIcon(name)` in the bundle:

| Ref kind | Icon name | Additional overlay |
|---|---|---|
| HEAD (worktree) | `worktree` | — |
| HEAD (local branch) | `head` | — |
| REMOTE (known host) | `remote-${hostingServiceType}` (e.g., `remote-github`) | host avatar URL |
| REMOTE (no host) | `remote` | — |
| TAG | `tag` | — |

Tooltip IDs (for localization anchors):
- `Ref-Remote`, `Ref-Tag`, `Ref-Local`, `Ref-Worktree`
- `Ref-Current` (checkmark)
- `Ref-Pinned` (pin icon)

## Ordering within a row's pill group

When a commit has multiple refs, they're rendered in this order:

1. The `activeGraphRefGroup` (the checked-out ref) first.
2. The group containing the pinned branch next.
3. Remaining groups sorted by:
   - **Type priority (descending)**: `WORKTREE(3) > HEAD(2) > REMOTE(1) > TAG(0)`.
   - Count of refs in the group (descending).
   - Alphabetical by name.

Within a single group (remote refs from multiple remotes), owner precedence is
`origin > upstream > other`.

## Overflow — the `+N` chip

Only the first ref pill in a commit's group is rendered inline. The rest are
stashed into a popover that opens on click of a `+N` chip:

```
[ first-pill ] [ +3 ]     ... commit message ...
```

Styling: `<span class="overflow-count ml1 [is-active]">+{N}</span>` where
`N = refGroups.length - 1`.

The popover (`_d` component) lists all hidden pills when clicked.

## Hard cap: 100 refs per commit

Constant: `REF_ZONE_MAX_REFS_TO_RENDER = 100` (minified symbol `gi`).

If a commit has more than 100 refs, the remaining ones are **silently
truncated** with no `+N` chip — only a disabled context menu entry
`"X refs not displayed"` surfaces the count.

Yryvu opportunity: show the `+N` chip even at the 100-ref cap instead of
truncating silently.

## Yryvu implementation for #55

Data already streamed: `GraphRow.refs: Vec<RefTag>` where
`RefTag { name, kind: Branch | RemoteBranch | Tag | Head }`.

Steps:

1. In the `<ul class="commit-graph__col-messages">` map function, render a
   new cell **before** the sha/summary/author — but actually, since we have
   a 3-column grid, the ref pills belong in the BRANCH/TAG cell (currently
   empty placeholder).
2. Group row refs by type + owner, apply the ordering above.
3. Render first pill inline in the BRANCH/TAG cell; if `group.length > 1`,
   render a `+N` chip that toggles a popover.
4. Add a context menu on each pill: checkout, rename, delete, pin to left
   (etc., wiring into existing `useBranchOps`).
5. Expose `active` (current HEAD), `pinned` annotations visually.
6. Icons: find or generate SVG set for head / remote / tag / worktree.
   Consider Phosphor or Heroicons for consistency with the existing UI.

Pill coloring option: tint the pill with the lane's color (our
`color_idx` is already on `GraphRow`) — subtle but helpful for tracing a
branch visually across the column + graph.

## Source locations

Bundle: same file.

- `Nd` — pill component (offset ~11797419).
- `nd` — icon factory (offset ~11796673).
- `sm` — container that renders `Ka` className.
- `su` — overflow `+N` chip (offset ~11847338).
- `_d` — popover component.
- `hn` — group sort comparator (offset ~11947000).
- `gi` — 100-ref cap constant.
- `getRefsNotDisplayed` (offset ~4573322) — renders the disabled "X refs
  not displayed" menu entry.
