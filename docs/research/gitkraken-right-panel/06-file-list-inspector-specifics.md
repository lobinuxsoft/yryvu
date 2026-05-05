# File list — inspector-specific behavior

The inspector's file list is structurally the same widget covered in
`gitkraken-diff/05-file-list-widget.md` (TreeView + atoms + flat/tree
toggle + filter). This doc only covers what's **different** or
**specific** when rendering committed content.

## listType

```js
<FileList fileListType={listTypes.COMMITTED} isDisabled={false} key={listTypes.COMMITTED}/>
```

The widget is generic over `listTypes`. Branching points:

- **Data source**: for `COMMITTED`, the file list reads from the diff
  result of the currently-selected SHA range (or a single-commit vs
  parent). For `STAGED`/`UNSTAGED`, it reads working-tree state.
- **Staged dot indicator**: the staging-area dot is only rendered in
  `STAGED`/`UNSTAGED` modes; never in `COMMITTED`.
- **Hover actions**: the "stage/unstage" buttons don't exist in
  `COMMITTED` — just view/diff/copy actions. (Cherry-pick, revert
  file-level actions are in the right-click menu, not hover.)

## Per-row anatomy (COMMITTED mode)

```html
<div class="file-list-row" draggable?>
  <StatusIcon type={ADDED | MODIFIED | DELETED | RENAMED}/>
  <FileIcon extension={...}/>
  <span class="file-path">{treeMode ? basename : fullPath}</span>
  <span class="file-diff-stat">
    <span class="additions">+{addedLines}</span>
    <span class="deletions">-{removedLines}</span>
  </span>
  {/* no staging dot in COMMITTED */}
</div>
```

(Exact DOM structure not grepped; inferred from the shared widget
structure and the `{+N / -N}` pattern seen in multi-commit cards.)

## Sorting

The file list is **path-sorted** (alphabetical on full path) when flat,
and **tree-sorted** (depth-first by directory name, then file name)
when tree. There's no "sort by churn" or "sort by type" option.

Scrolled through the bundle looking for `sortBy`, `fileSort`, `sortFiles`
— no hits for an alternative-sort toggle. Baseline is path-alphabetical.

**For chajá**: don't add sort options that don't exist upstream; they
become divergence liabilities. If users want it later, add a user
setting.

## Context menu items (per file)

Strings that apply in `COMMITTED` mode:

- `ContextMenu-CopyFilePath` = `"Copy file path"`
- `ContextMenu-CopyCommitSha` = `"Copy commit sha"` (on the containing commit)
- `FileHistory-BlameButtonLabel` = `"Blame"` (opens blame view for the file at this sha)
- `FileViewPanel-History` = `"History"` (file history for this path)
- `FileHistory-LinkToGraph` = `"View {0} on graph"` (jump to commit from file-history mode)

Not present / not grepped as specific items: "open in editor from this
commit" — GK's file ops at a past commit typically route through the
diff view rather than a per-file menu entry. Inferred.

## Hover actions (per file)

Searched for hover-button patterns on file rows — limited evidence.
What's confirmed:

- Double-click row → opens diff in main area.
- Single click → selects file and updates diff viewer on the left.
- Right-click → context menu above.

A dedicated hover-action bar (like VS Code's inline icons on the file
node) is **not** a clearly-visible pattern in the bundle. Mostly
right-click-driven.

## Drag / drop

`FILE_NODE_HEIGHT = 32`. The file rows are drag-sources — you can drag
a committed-file row into an external editor tab (Electron treats it
as a native OS drag, dropping a temp copy). This is a Windows/macOS
integration detail; porting to chajá via Tauri will need matching OS
drag-source registration.

## Per-row dims (constants grepped)

```
FILE_NODE_HEIGHT               = 32
TINY_ICON_SIZE                 = 12
TINY_ICON_RIGHT_MARGIN         = ? (referenced but number not extracted)
FILE_NODE_CONTENTS_DIRECTORY_PADDING_LEFT = 3
FILE_NODE_CONTENTS_PADDING_LEFT           = 10
TREE_VIEW_LEVEL_INDENT         = 15
INLINE_SUMMARY_MARGIN_LEFT     = 10
VERTICAL_SCROLLBAR_WIDTH       = 8
LFS_LABEL_WIDTH                = 31
```

Layout math for a file row in COMMITTED mode:

```
y_position = rowIndex * FILE_NODE_HEIGHT                              // 32 px
padding_left = treeDepth * TREE_VIEW_LEVEL_INDENT + FILE_NODE_CONTENTS_PADDING_LEFT
             = depth * 15  +  10
stat_x       = rowWidth - VERTICAL_SCROLLBAR_WIDTH - (inline stats width)
```

Matches what we already implemented in `diff/05`. Keep those numbers
across the inspector too.

## Chajá implications

1. **Same widget, `listType=COMMITTED`**. If chajá's FileList widget
   takes a variant parameter, adding the inspector is just wiring the
   variant.
2. **No staging dot**, **no stage/unstage buttons** in COMMITTED mode.
3. **Path-sorted, no other sort options**. Don't add options.
4. **Row height 32 px, tree indent 15 px, padding-left 10 px**. Reuse
   the same constants from the diff file-list doc.
5. **Context menu**: subset of the file-level menu. `Copy file path`,
   `Blame`, `History`, `Copy commit sha` are the staples. Route through
   the shared menu module so both sides share implementations.
6. **Hover actions**: not a strong pattern in GK — don't over-engineer
   a hover-bar. Single-click selects, double-click opens, right-click
   menus.
7. **File drag-source**: nice-to-have later (especially via Tauri).
   Skip in the first port.

## Source

Bundle: same. Most of the row-level widget evidence lives in
`gitkraken-diff/05-file-list-widget.md`; this doc only covers the
inspector-specific branches.

- `listTypes.COMMITTED` — variant switch.
- `FILE_NODE_HEIGHT=32`, `TREE_VIEW_LEVEL_INDENT=15`,
  `FILE_NODE_CONTENTS_PADDING_LEFT=10`, `FILE_NODE_CONTENTS_DIRECTORY_PADDING_LEFT=3`,
  `VERTICAL_SCROLLBAR_WIDTH=8` — dims.
- `ContextMenu-CopyFilePath` / `ContextMenu-CopyCommitSha` /
  `FileHistory-BlameButtonLabel` / `FileViewPanel-History` — en-US
  strings.
