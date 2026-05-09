# Stats summary + file list

The commit inspector's bottom section is a `CommitDiffSection` that
unites three concerns in a fixed order: stats summary → filter input →
file list. No toggle between them — they stack.

## Layout

```jsx
const CommitDiffSection = ({ added, deleted, diffCalcInProgress,
                             modified, renamed, translate }) => (
  <div className="commit-diff">
    <CommitDiffStatSummary added modified deleted renamed
                            showLoadingIndicator={diffCalcInProgress}
                            translate/>

    <FileListFilterInput/>                     {/* doc covered in diff/05 */}

    <FileList fileListType={listTypes.COMMITTED}
              isDisabled={false}
              key={listTypes.COMMITTED}/>
  </div>
);
```

`listTypes` enum (module-level):

```js
listTypes = {
  COMMITTED:  "committed",
  STAGED:     "staged",
  UNSTAGED:   "unstaged",
  CONFLICTED: "conflicted",
}
```

The right panel uses `COMMITTED` exclusively. The staging side uses
`STAGED`/`UNSTAGED`; merge-conflict panel uses `CONFLICTED`.

## Stat summary (the "chips" row)

Rendered from keys:

| Field      | i18n key                             | Default EN         |
|------------|--------------------------------------|--------------------|
| added N    | `CommitDiffSection-NFilesAdded`      | `{0} added`        |
| modified N | `CommitDiffSection-NFilesModified`   | `{0} modified`     |
| deleted N  | `CommitDiffSection-NFilesDeleted`    | `{0} deleted`      |
| renamed N  | `CommitDiffSection-NFilesRenamed`    | `{0} renamed`      |

Singular forms exist too (`-FileAdded` etc.) as plain `added`, `modified`,
`deleted`, `renamed`, but the `NFiles*` plural keys are always
interpolated with the count (`{0}`).

Pattern reused verbatim in three places:

```js
const F = {
  [ADDED]:    "CommitDiffSection-NFilesAdded",
  [DELETED]:  "CommitDiffSection-NFilesDeleted",
  [MODIFIED]: "CommitDiffSection-NFilesModified",
  [RENAMED]:  "CommitDiffSection-NFilesRenamed",
}
```

so adding a new change type would require extending this table.

### Loading indicator

`diffCalcInProgress: boolean` is passed through as `showLoadingIndicator`.
When true, GK overlays a spinner next to the stat summary (typically
while the diff engine computes stats on the renderer side from the
parent compare — a few hundred ms on big commits).

### No +N/-N line churn

Searched — the inspector's summary shows **file counts by type**, not
line additions/removals. There is no GitHub-style `+123 / -45` number
anywhere in the panel header. Line counts appear **per file row** in
the file list as a mini diffstat (see doc 06), but the top aggregate is
purely file-counted.

This is a conscious GK choice — line churn is per-file, file types are
per-commit.

### No visualization bar/chart

No bar chart, no pie chart, no stacked histogram. Just text chips.

## File list

The file list component below the summary is the same widget covered
in `gitkraken-diff/05-file-list-widget.md`. Brief recap of what it
shows for the COMMITTED list type:

- **Tree vs flat** toggle (`isContentsTreeDisplayed`), per-repo persisted.
- **Filter input** (`RightPanel-FilterFiles` = `"Filter files"`).
- **Per-row**: status icon (ADDED/MODIFIED/…), file icon by extension,
  path (tree=basename, flat=full), `+N/-N` mini diffstat, stage indicator
  dot.
- **Click**: selects file, triggers diff view.
- **Right-click**: per-file context menu.

State keyed by `(repoId, sha, isContentsTreeDisplayed)` via
`replaceTreeViewUsingPureMutator`. Same machinery whether it's the WIP
list or a committed list.

### `data-testid` mapping

The outer section marker:

```html
<div class="commit-detail-section"
     data-testid="commit-detail-panel">
  {headerStuff}
  <CommitDiffSection added={s.added} deleted={s.deleted}
                     modified={s.modified} renamed={s.renamed}
                     diffCalcInProgress={...} translate={...}/>
  {restOfChildren}
</div>
```

(Note: the `data-testid="commit-detail-panel"` sits on an **inner**
`commit-detail-section` container, *inside* the outer `commit-detail-panel`
div. Slightly confusing naming — the outer className matches the
inner testid. Don't mirror that inconsistency in yryvu.)

## Source

Bundle: same.

- `CommitDiffSection=({added:Ve,deleted:at,diffCalcInProgress:ct,modified:dt,renamed:Rn,translate:An})` — component factory.
- `className:"commit-diff"` — outer wrapper.
- `listTypes=function(Ve){return Ve.COMMITTED="committed",Ve.CONFLICTED="conflicted",Ve.STAGED="staged",Ve.UNSTAGED="unstaged",Ve}` — list type enum.
- `{[ADDED]:"CommitDiffSection-NFilesAdded", [DELETED]:"…NFilesDeleted", [MODIFIED]:"…NFilesModified", [RENAMED]:"…NFilesRenamed"}` — key mapping.
- `"CommitDiffSection-NFilesAdded":"{0} added"` etc. — en-US strings.
- `diffCalcInProgress` — loading flag.
- `"commit-detail-section"` + `data-testid="commit-detail-panel"` —
  outer container for the inspector's bottom.

## Yryvu implications

1. **Flat text chip summary** — no bar/chart, no line churn at this
   level.
2. **4 categories** (added / modified / deleted / renamed) matching GK
   enum. If yryvu has more change types (conflicted, resolved), extend
   the key mapping but don't add them to the top-level summary unless
   UX warrants.
3. **Loading flag** (`diffCalcInProgress`) drives a spinner next to
   the summary while the diff engine crunches stats. Plug this into
   yryvu's async diff pipeline so the UI doesn't read as empty during
   compute.
4. **Filter + tree/flat** come from the shared widget in diff doc 05.
   Same code path used by the inspector; don't fork.
5. **i18n keys**: reuse GK's `CommitDiffSection-NFiles*` naming for
   easy copy of existing translations; `{0}` placeholder preserved.
