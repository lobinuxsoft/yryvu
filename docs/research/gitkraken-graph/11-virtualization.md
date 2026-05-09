# Virtualization & scroll performance

GitKraken uses **react-virtualized** (not react-window). The commit graph is
one `<Grid>` per zone, horizontally concatenated inside a shared scroll
container. Overscan is deliberately **zero** for the graph — only visible
rows are mounted.

## Library

`react-virtualized` is bundled (see exports `Grid`, `List`, `AutoSizer`,
`MultiGrid`, `WindowScroller`, `InfiniteLoader` near offset 77000–950000).
The `List` default export sits in the bundle with:

```
List.defaultProps = {
  autoHeight: false,
  estimatedRowSize: 30,           # unused by graph (fixed height)
  overscanIndicesGetter: accessibilityOverscanIndicesGetter,
  overscanRowCount: 10,           # default — overridden by graph
  scrollToAlignment: "auto",
  scrollToIndex: -1
};
```

## Graph-specific configuration

Each zone renders one column container (internal class `oW`) that instantiates
a `Grid` (not a `List`) via factory `Wo`:

```
createElement(Grid, {
  autoContainerWidth: true,
  cellRangeRenderer: smartCellRangeRenderer,   # custom
  cellRenderer: (cell) => Y(zone, cell),
  className: "graph-panel react-virtualized-list pad-for-horizontal-scrollbar",
  columnCount: 1,
  columnWidth: currentZoneWidth,
  height: graphHeight,
  isScrolling: false,                          # forced false
  overscanRowCount: 0,                         # ← zero
  rowCount: processedRows.length,
  rowHeight: 28,                               # GRAPH_ROW_HEIGHT
  scrollLeft, scrollToIndex, scrollTop
});
```

Key points:
- `overscanRowCount: 0` → no off-screen rows mounted. Works because rows
  have uniform height (28px) and recycling is cheap.
- `isScrolling: false` hard-coded → React-Virtualized's scroll optimizations
  (which skip children during active scroll) are disabled. Every scroll tick
  re-renders visible rows. GitKraken trusts its own memoization to be fast
  enough.
- `smartCellRangeRenderer` is a custom replacement for
  `defaultCellRangeRenderer`. Appears near offset 11741788. It wraps each
  cell in a `<span data-column-name data-row-idx>` for diagnostics/CSS
  targeting. Not a fundamental behavior change.

## Row recycling

React-Virtualized's built-in `CellMeasurerCache` and
`cellSizeAndPositionManager` handle pooling. DOM nodes are **not** kept in
a custom pool — the library destroys and recreates per scroll. The
className strings, however, **are** pooled in module-level `Bd`/`Gd` caches
(see doc 12).

## Multi-column scroll sync

All zones are siblings inside a horizontal flex. Each has its own Grid.
Scroll is synchronized via a shared `scrollTop` prop passed to every
column, with `onScroll` bubbled up to the parent and re-dispatched via
Redux. One column (the first) owns `onScrollToRowCausedUpdate` so that
`scrollToIndex` effects (e.g. after "select commit") fire exactly once.

## Lazy loading

Constant:

```
GRAPH_ROW_LAZY_LOAD_COMMITS_OFFSET = 1400
```

Used to decide when to fetch the next batch of commits — when the scroll
position is within 1400 px (≈50 rows) of the bottom, a saga requests more.

`maxCommitCountDefault` is the initial batch size. The value is referenced
by `shiftSelectSaga` and `refreshSaga`, with a fallback of "all" when the
user has git-binary mode enabled. No hard cap on total commit count was
observed — repos of 100k+ are streamed in batches of `maxCommitCountDefault`.

## ResizeObserver

An `AutoSizer` (from react-virtualized) wraps the graph container. It uses
`ResizeObserver` internally (seen in exports, offset 10120). No explicit
debounce in the graph wiring — the library emits synchronous resize events.
The grid's internal scroll+resize handler fires without rAF throttling. On
very fast window resizes this can tear; GitKraken accepts the trade-off.

## Yryvu implications

- For Solid: `@solid-primitives/virtual` or a hand-rolled Intersection
  Observer windowing is appropriate. Don't copy `overscanRowCount:0` blindly
  — Solid's granular reactivity means overscanning a few rows costs almost
  nothing and avoids a "pop-in" on fast scroll.
- **Do copy**: fixed row height (28px) + per-zone independent virtualizers
  with shared `scrollTop`. It's easy to implement and composes well.
- **Do copy**: lazy-load threshold of ~1400 px (≈50 rows). Gives
  imperceptible loading.
- Don't force `isScrolling: false`. Solid doesn't have React's
  "scrolling skip" behavior, so the problem doesn't exist.

## Source locations

- react-virtualized `List` defaults: ~744215.
- `Grid` constructor: ~847112.
- `smartCellRangeRenderer` site: ~11741788.
- Per-column-zone container factory (`oW`): ~11913000 (referenced by graph
  render ~11914000).
- `GRAPH_ROW_LAZY_LOAD_COMMITS_OFFSET = 1400`: module 214, ~2552400.
- `overscanRowCount: 0` graph override: ~11742840.
