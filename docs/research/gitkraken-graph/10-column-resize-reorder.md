# Column resize & reorder

GitKraken's graph columns (the "zones") are both resizable via right-edge
drag handles and reorderable via header drag-and-drop. Persistence is split
across two Redux stores: **order + mode + visibility per-profile**, **width
per-repo**.

## Zones

Zones are identified by string IDs (module 90210):

| Zone ID              | Header label       | listId                  |
|----------------------|--------------------|-------------------------|
| `refZone`            | BRANCH / TAG       | `ref-zone`              |
| `commitZone`         | GRAPH              | `commit-zone`           |
| `commitMessageZone`  | COMMIT MESSAGE     | `commit-message-zone`   |
| `commitAuthorZone`   | AUTHOR             | `commit-author-zone`    |
| `commitDateTimeZone` | COMMIT DATE / TIME | `commit-date-time-zone` |
| `commitShaZone`      | SHA                | `commit-sha-zone`       |
| `changesZone`        | CHANGES            | `changes-zone`          |

## Per-zone constants (pixels)

| Zone            | min     | default | compact | max |
|-----------------|---------|---------|---------|-----|
| ref             | (var)   | 130     | 32      | 300 |
| commit (graph)  | (var)   | —       | —       | —   |
| commitMessage   | (var)   | 300     | 500     | 800 |
| commitAuthor    | (var)   | 130     | 32      | 175 |
| commitDateTime  | (var)   | 130     | 130     | 175 |
| commitSha       | (var)   | 130     | 130     | 100 |
| changes         | (var)   | 200     | 200     | 800 |

Column-mode enum: `Compact | Rich | Text`. Each zone stores its own `mode`.
The graph zone (`commitZone`) is **the only zone without a maximum width** —
it is the fluid column and always occupies `numGraphColumns * columnWidth`
natural space. All others clamp to `maximumWidth`. Columns do not use CSS
`1fr`; the whole row is a horizontal flex of fixed-width sub-lists.

`HEADER_ROW_HEIGHT = 22px`, `HEADER_ROW_MARGIN_BOTTOM = 2px`,
`GRAPH_HEADER_ROW_HEIGHT = 26px`.

## Resize behavior

Rendered per-header (class `Md`, module near bundle offset 11808284).
Each header wraps its label in a `<Resizable>` component (internal class
`nl`) configured with:

```
{ resizeEdge: "right",
  handleStyles: { right: { right: 0 } },
  resizeHandleClassName: "z2 border-right",
  widthConstraints: getWidthConstraints(zoneType, graphWidth, columnWidth) }
```

The last column gets `"is-last-header"` and skips the resize wrapper (no
handle on the far right edge). Double-click auto-size: **not implemented** —
there is no handler in the bundle for `onDoubleClick` on the resize grip.

While dragging, `isResizingElsewhere` propagates so siblings can suppress
hover effects. Overflow behavior: when total row width > viewport width,
the entire `react-virtualized-list` container horizontally scrolls (class
`pad-for-horizontal-scrollbar`).

## Reorder behavior

Implemented by class `Dd` (module near 11810160). It wraps the header row
in a react-dnd `DragDropContext` with a custom `ul` container (direction
"horizontal"). Each header is both a `DragSource` and a `DropTarget`:

```
isDraggable  = (h) => this.canDrag && h.props.isDraggable;
isDroppable  = (src, tgt) => src.zone !== tgt.zone && tgt.isDroppable;
onDrop       = (src, tgt) => this.onColumnReOrdered(src.zone, tgt.zone);
onZoneHover  = () => { this.canDrag = true; };
```

Only zones with `isCustomizable: true` are reorderable. **All graph zones
except `commitZone` (the lane graph) are reorderable**. The graph zone has
`isCustomizable` not set → it stays pinned. The drop zone is the entire
sibling header (no mid-drop line indicator — react-dnd default highlight
via `.is-draggable`).

No drag-preview ghost is custom; it uses react-dnd's native `DragLayer`.

## Persistence

Two Redux paths, both under `ui.graphOptions.columns`:

```
GRAPH_COLUMN_SETTINGS_PATH = ["ui", "graphOptions", "columns"]
# per-zone shape:
#   { order, mode, visible, descDisplayMode, currentWidth }
```

Order and mode are per-profile (cloud-synced). Width is stored per-repo at
`layout.GraphPanel.<zoneType>.width` (see `widthRepoSettingPath` in
`getSettingPathsForGraphZoneType`).

Two separate sagas:
- `saveNewGraphZoneOrder(zones[])` → rewrites `order` indices 0..N on the
  profile setting.
- `saveGraphZoneSize(zone, repoPath, width)` → wraps in a
  `REPO_SETTINGS` lock and calls `setRepoSetting(widthRepoSettingPath, ...)`.

## Yryvu implications

- Two separate stores from day one: **profile-level order/mode, repo-level
  width**. Don't conflate them.
- For issue #38 (reorder): lock the graph column, allow others to swap.
  react-dnd is heavy; a Solid `createDragAndDrop` primitive or native HTML5
  drag events are sufficient.
- For issue #37 (resize): right-edge handle only, no left. Last column has
  no handle. Use `resize: horizontal` CSS? No — GitKraken rolls its own
  because CSS resize is ugly. A small absolute-positioned div over the
  right border with `onMouseDown → document.addEventListener("mousemove")`
  is the correct pattern (DragHandle class, module 96649).
- Skip double-click auto-size unless a user asks. GitKraken doesn't have it.

## Source locations

- Constants & paths: module 90210 (`graphZoneMetaData`, ~offset 10511884).
- Dimension constants: module 214 (`GRAPH_ROW_HEIGHT`, etc., ~2552400).
- Header rendering class `Md`: ~11808284.
- Reorder wrapper class `Dd`: ~11810160.
- Resize save saga `saveGraphZoneSize`: ~5278547.
- Order save saga `saveNewGraphZoneOrder`: ~5278522.
- Generic DragHandle (panels, not columns): module 96649 (~11331412).
