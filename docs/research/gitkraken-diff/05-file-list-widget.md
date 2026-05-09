# File list widget — RightPanel tree / flat / filter

GitKraken's file list lives in a right-side panel that lists the files
changed by the current selection (commit, range, or working directory).
It supports a **tree vs flat** display toggle, an expand/collapse-all
button, a filter input, and per-repo persistence.

Not the three-mode Path/Tree/Flat that an earlier Yryvu draft assumed —
there are **two** display modes, plus a "View all files" button for
multi-commit selections.

## Panel strings (RightPanel-)

Observed string keys with `RightPanel-` prefix:

```
RightPanel-View
RightPanel-ViewAllFiles
RightPanel-ViewChange
RightPanel-ViewChanges
RightPanel-ViewConflict
RightPanel-ViewConflicts
RightPanel-ViewNFileChangesInWorkingDirectory
RightPanel-ViewNFileConflictsInWorkingDirectory
RightPanel-NChangesOn
RightPanel-NCommitsSelected
RightPanel-FilterFiles
RightPanel-MergeConflictsDetected
RightPanel-RebaseConflictsDetected
RightPanel-CreatingCloudPatch
RightPanel-CreatingCloudPatchForPullRequest
RightPanel-Reviewing
RightPanel-SuggestChangeToPullRequest
RightPanel-SuggestionFor
RightPanel-UnsupportedRebase
```

The `View…` variants are header captions, the `N…` variants are
summary labels with count substitution, and `FilterFiles` is the search
input placeholder.

## Display mode — binary toggle

The panel has one boolean state controlling layout:

```js
isContentsTreeDisplayed: boolean  // true = tree, false = flat list
```

When `true`, paths are grouped by directory and rendered as a nested
accordion. When `false`, paths are shown as a flat list with full path
strings.

This is **not** a three-mode enum. Yryvu's existing #61 draft proposed
"Path / Tree / View-all-files modes" — the 1:1 GitKraken reality is:

- **Tree** or **Flat** (binary toggle via `isContentsTreeDisplayed`).
- **"View all files"** is a **separate** button that changes the SOURCE
  (merged diff across selection) — not the display mode.

## Per-repo state — Jotai atoms

The state is held in Jotai atoms (GitKraken's state library of choice
in this render path):

```js
treeViewsByRepoAtom            // Record<repoId, TreeViewState>
filterQueriesByRepoAtom         // Record<repoId, string>
filteredTreeViewsByRepoAtom     // derived — filter applied to trees
```

Where `TreeViewState` includes:

```ts
{
  treeViewFullyExpanded: boolean;           // expand-all toggle
  treeViewHasDirectories: boolean;          // flat paths have no dirs — skip tree UI
  treeViewNodesByPath: Record<path, Node>;  // path → node lookup
}
```

The service class (not a React component) manages the atoms and exposes
mutator actions.

## Actions

Observed Redux action names routed through `addHandler`:

| Action                                        | Effect |
|-----------------------------------------------|--------|
| `TreeViewAllDirectoriesCollapsedStateSet`     | Set expand-all or collapse-all. Pure mutator via `setEveryNodeInTreeViewIsCollapsed`. |
| `TreeViewDirectoryAccordionToggle`            | Toggle a single directory's accordion state. |
| `TreeViewFileForcedVisible`                   | Force a file visible when the filter would hide it — used on selection. |
| `TreeViewAtShaReset`                          | Clear all tree state for a specific commit sha (on re-select). |

All route through `replaceTreeViewUsingPureMutator(repoId, shaOrFileListType, isContentsTreeDisplayed, mutatorFn, args)` — pure state replacement pattern keyed on `(repoId, sha/fileListType, displayMode)`.

## Filter

The `FilterFiles` input filters nodes by substring on the full path.
Filter query is persisted separately (`filterQueriesByRepoAtom`) so
switching repos restores that repo's last filter.

Match semantics: case-insensitive substring on full path. Matching a
file auto-expands its ancestor directories (see `TreeViewFileForcedVisible`).

## Item anatomy (per row)

Each row carries:

- Status badge (the change type — see doc 06 for the `types` enum:
  ADDED/MODIFIED/DELETED/RENAMED/CONFLICT/RESOLVED/CURRENT/DIRECTORY).
- File icon (by extension, from the project's icon set).
- Full path (flat mode) or base name (tree mode).
- Line count +/- summary (mini-diffstat): `+12 / -5`.
- Staged-indicator dot (if file is in staging area).
- Click → select file in diff viewer.
- Right-click → context menu (open, discard, stage, unstage, copy path,
  revert, …).

## Multi-commit "View all files"

When selection spans multiple commits, the panel header switches to
`RightPanel-NCommitsSelected` and the "View all files" button appears.
Clicking it computes the merged diff across the selection and renders
it in the same tree/flat layout.

Reference strings for multi-commit mode:

```
CommitDetailPanel-DiffBetweenACommitAndTheWIP  = "Viewing diff between a commit and the WIP"
CommitDetailPanel-DiffBetweenCommitsTitle      = "Viewing merged diff of {0} commits"
CommitDetailPanel-DiffBetweenTwoCommits        = "Viewing diff between 2 commits"
```

## Yryvu implications

- **Bin the "Path / Tree / Flat" 3-mode from #61's draft** — GitKraken
  has Tree and Flat, plus the multi-selection "View all files" is a
  separate source switch, not a display mode.
- **Tree uses directory-grouping accordion**; Flat shows full paths.
- **Filter is persistent per-repo**, like GitKraken — when user switches
  back to a repo the last filter string restores.
- **Expand-all button** is a single action, not per-directory preferences.
- **On selection**, force the selected file visible by expanding
  ancestors if filter hides it.
- Use **Solid's store / createStore** for the equivalent of Jotai
  atoms. Key state by `(repoId, shaOrFileListType, isContentsTreeDisplayed)`
  to match GitKraken's replacement discipline.
- The **filter input placeholder** is the canonical "FilterFiles" string —
  `"Filter files"`. Matches the sidebar ref-filter pattern from #113.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `RightPanel-ViewAllFiles` — button label.
- `RightPanel-FilterFiles` — filter placeholder.
- `isContentsTreeDisplayed` — the binary toggle.
- `treeViewFullyExpanded`, `treeViewHasDirectories`, `treeViewNodesByPath` — tree state fields.
- `treeViewsByRepoAtom`, `filterQueriesByRepoAtom`, `filteredTreeViewsByRepoAtom` — Jotai atoms.
- `TreeView(AllDirectoriesCollapsedStateSet|DirectoryAccordionToggle|FileForcedVisible|AtShaReset)` — actions.
- `replaceTreeViewUsingPureMutator` — the pure mutator dispatcher.
