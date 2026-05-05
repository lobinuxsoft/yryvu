# Interactions & state

Concrete behaviors for selection, keyboard, context menu, search, density,
and tooltips. Most interactions route through Redux sagas rather than React
state — makes them replayable and testable.

## Selection

Actions live in module 95584 (offsets ~998000–1026000):

| Saga                                    | Trigger                                       |
|-----------------------------------------|-----------------------------------------------|
| `selectCommit(sha)`                     | Plain click                                    |
| `selectNext()` / `selectPrevious()`     | Arrow keys (time-ordered)                      |
| `selectNextTopological()` / `selectPreviousTopological()` | Arrow keys (topological mode) |
| `selectFirstCommit()` / `selectLastCommit()` | Home / End (inferred)                     |
| `selectWIP()` / `selectWipOrFirstCommit()` | When WIP row visible                        |
| `shiftSelect(sha)`                      | Shift+click (multi-select range)               |
| `setSelectedShas(shas[])`               | Ctrl/Cmd+click (toggle individual)             |

### Multi-select — `shiftSelect` saga

Uses nodegit directly to compute the ancestor relationship between the
click target and the last-selected commit (pseudocode):

```
function* shiftSelectSaga(targetSha) {
  const selected = yield select(getSelectedShas);
  if (selected.includes(targetSha)) return;

  const last = _.last(selected);
  # Normalize WIP / merge-conflict to HEAD
  const [a, b] = [normalize(targetSha), normalize(last)];

  # Figure out ancestry direction in parallel
  const [aIsDescendant, bIsDescendant] = yield all([
    call(Graph.descendantOf, repo, a, b),
    call(Graph.descendantOf, repo, b, a)
  ]);

  const [from, to] = aIsDescendant ? [a, b] : [b, a];

  const walker = yield call(repo.createRevWalk);
  yield call([walker, walker.sorting], Revwalk.SORT.TIME);
  yield call([walker, walker.push], from);
  const commits = yield call([walker, walker.fastWalk], maxCommitCountDefault);

  # Build inclusive range [from..to]
  const range = [];
  for (const c of commits) {
    range.push(c.sha);
    if (c.sha === to) break;
  }
  yield call(selectShasCalculateDiffAndRetrieveFiles, _.union(range, selected));
}
```

Note the `fastWalk` cap at `maxCommitCountDefault` — you can't shift-select
across more than that many commits without re-loading.

No lasso selection was observed.

## Keyboard navigation

The `graph-component` div has `tabIndex={-1}` and focuses via the
`focusGKGraphContainer` saga. Arrow/Page/Home/End handling is not a flat
`onKeyDown` — it dispatches to the sagas above through a keymap
intermediary. The full `Ns` scancode table is present (offset ~1928867):
`33:"PageUp", 34:"PageDown", 35:"End", 36:"Home", 37:"ArrowLeft", 38:"ArrowUp",
39:"ArrowRight", 40:"ArrowDown"`.

Modifier props on synthetic events: `altKey`, `ctrlKey`, `metaKey`,
`shiftKey`. Standard fare.

`ArrowLeft` and `ArrowRight` were **not found** to be bound on the graph
(unlike a tree view — graph is 1-D). Focus ring is the default Electron
outline; no custom styling observed.

## Context menu

Per-commit context menu is opened by `onCommitContextMenu` handler on the
`Ud` row wrapper. It receives `(event, zoneType, sha)` and dispatches to
`onPopupGraphHeaderContextMenu` (misnomer — it handles both header and
body).

The **menu is data-driven**, built by composing the following (names
grepped, all present with 50–350 occurrences each):

- `getToggleRefSolo` (solo branch filter)
- `getCopyShaAction`
- `CreateBranch`, `CreateTag`
- `Cherrypick`
- `InteractiveRebase`, `RewordCommit`
- `ResetTo` (soft/mixed/hard variants)
- `RevertCommit`, `SquashCommit`, `FixupCommit`

Entries are functions returning menu-item objects
`{ label, onClick, shortcut?, separator?, disabled? }`. The list is
filtered by commit type (normal vs merge vs WIP), selection size, and
ref-solo state. Menu rendering goes through the native Electron menu
(not a React portal) — the saga emits to `ipcRenderer`.

## Search / filter

Library: **MiniSearch** (bundled, offsets 9677508+). Used as
`CommitSearchIndex` built on commit load via `buildCommitSearchIndex`.

| Saga                                     | Purpose                          |
|------------------------------------------|----------------------------------|
| `buildCommitSearchIndex`                 | Initial + incremental indexing   |
| `changeCommitSearchMessage(query)`       | User types                       |
| `filterCommitsOnCommitSearchQuery`       | Re-filter visible rows           |
| `selectNextCommitFromCommitSearch`       | ↓ through results (F3)           |
| `selectPreviousCommitFromCommitSearch`   | ↑ through results (Shift+F3)     |
| `openCommitSearch` / `closeCommitSearch` | Show/hide search bar             |

Searchable fields include sha, author name, message summary, message body.
MiniSearch's auto-vacuum runs with `{batchSize, batchWait}` to keep the
index small when commits are removed from the visible set.

Results are stored in Redux (`getOrderedCommitSearchResults`) with an
index pointer (`getCommitSearchIndex`). "Next match" is `(index + 1) %
results.length` — wraps around.

Highlight rendering was not located in the bundle (likely lives in the
`commitMessageZone` cell renderer `nV`, offset range 11913500+). No
substring `<mark>` wrapping was found, so highlighting is probably by
CSS class `match-highlight` applied to the cell, not per-character.

## Density toggle

The "compact / standard / rich" toggle is **per-zone**, not global. Each
zone stores its own `GraphColumnMode`:

```
GraphColumnMode = { Compact: "compact", Rich: "rich", Text: "text" }
```

Persisted at `ui.graphOptions.columns.<zoneType>.mode`. Each zone has
`compactColSettings` + `defaultColSettings` pre-seeded. Toggled via the
zone header's "…" menu (saga `toggleGraphZoneMode`).

There is **no single "compact view" switch** for the whole graph. The
`density` term in the bundle refers to the Focus View tab, a different
surface, and is unrelated.

## Tooltips

Library: `react-bootstrap`'s `OverlayTrigger` (imported as `Rn.OverlayTrigger`,
offsets 11149584+).

Delays observed:
- **Icons in toolbars**: `delayShow: 750 ms`.
- **Ref pills / refs**: `delayShow: 250 ms` (module 1557000,
  `wrapTooltipElementForIssue`).

Placement defaults: `top` for icons, `right` for ref tooltips. Trigger:
`["hover", "focus"]`. Rendered as a portal at the document root (Overlay
default) — not inline. Content is plain strings, no HTML (except for ref
icons which nest FontAwesome inside).

## Chajá implications

- **Keep selection in a store, not a signal on the row**. Sagas are
  overkill for Solid; a Zustand-like store works. But the pattern of
  "last selected + target + ancestry walk" for range selection is worth
  copying verbatim.
- **Use MiniSearch** for commit search. It's ~30 KB minified, stable,
  exactly the right shape. Index on mount, incremental on new commits.
- **Wrap-around next/prev** — small touch, big UX win for F3/Shift+F3.
- **No global compact toggle** — per-column is more flexible and cheaper
  to persist. For issue #39 or similar, skip the binary compact mode.
- **Tooltip delays**: 250 ms for data-rich tooltips (refs, commits),
  750 ms for icon hints. Copy the values.
- **Context menu via native OS** (through Tauri's `menu` API) — portable
  and accessible. Build the menu as a function of `(commit, selection)`
  returning an array of `{label, action, shortcut, enabled}`.

## Source locations

- Selection sagas: module 95584, ~offsets 998000–1026000.
- `shiftSelect` saga body: ~1025415.
- Keyboard scancode table: ~1928867.
- Commit-search sagas: module 71626, ~7785200.
- MiniSearch library: ~9677508.
- Context menu popup dispatch (`onCommitContextMenu`): ~11814308.
- Tooltip (`OverlayTrigger`) with `delayShow:750`: ~11149584.
- Tooltip for refs (`delayShow:250`): ~1557197.
- `GraphColumnMode` enum: module 214, ~2553400.
