# Change types — status enum, content enum, icons and colors

GitKraken exposes **two** overlapping enums for file state in the diff
UI: a change-status enum (`types`) that captures the Git change class,
and a content-kind enum (`fileDataTypes`) that drives the rendering
path choice (binary vs text vs image vs submodule).

## Status enum — `types`

```js
at.types = {
  ADDED:     "added",
  CONFLICT:  "conflict",
  CURRENT:   "current",
  DELETED:   "deleted",
  DIRECTORY: "directory",
  MODIFIED:  "modified",
  RENAMED:   "renamed",
  RESOLVED:  "resolved",
}
```

Values are the lowercase strings; they also surface user-facing via the
`CommitDiffSection-File*` label keys:

```
CommitDiffSection-FileAdded     = "added"
CommitDiffSection-FileDeleted   = "deleted"
CommitDiffSection-FileModified  = "modified"
CommitDiffSection-FileRenamed   = "renamed"
```

Counter variants:

```
CommitDiffSection-NFilesAdded     = "{0} added"
CommitDiffSection-NFilesDeleted   = "{0} deleted"
CommitDiffSection-NFilesModified  = "{0} modified"
CommitDiffSection-NFilesRenamed   = "{0} renamed"
```

`COPIED` and `TYPECHANGE` are **not** distinct values in the enum —
git's copy detection surfaces as ADDED; git's typechange (symlink ↔
regular) surfaces as MODIFIED. This is a Git-standard simplification.

`CONFLICT`, `RESOLVED`, `CURRENT`, `DIRECTORY` are not change states
per se but UI-state sentinels that appear in the same column:

- `CONFLICT` — file has merge/rebase conflict markers.
- `RESOLVED` — conflict markers removed but not yet staged.
- `CURRENT` — file matches HEAD (shown only in the working-directory
  view as "no change", typically filtered out).
- `DIRECTORY` — row is a directory node in tree mode, not a file.

## Content kind enum — `fileDataTypes`

```js
fileDataTypes = {
  BINARY:    "BINARY",
  DELETED:   "DELETED",
  DIRECTORY: "DIRECTORY",
  IMAGE:     "IMAGE",
  SUBMODULE: "SUBMODULE",
  TEXT:      "TEXT",
}
```

Determines which renderer handles the file body:

- `TEXT` → Monaco DiffEditor (doc 01).
- `BINARY` → "Binary file" placeholder (string `FileContentsPanel-Binary`).
- `IMAGE` → image viewer (covered in diff Round 3).
- `SUBMODULE` → submodule pointer view (commit OIDs before/after).
- `DIRECTORY` → not rendered on its own; list node.
- `DELETED` → shows previous content with delete-indicator overlay.

## Icons per status (per row)

GitKraken renders the status as a single-letter colored badge at the
start of each file row:

| Status     | Badge letter | Color literal       |
|------------|--------------|---------------------|
| ADDED      | `A`          | green  `#3fb950`    |
| MODIFIED   | `M`          | yellow `#d29922`    |
| DELETED    | `D`          | red    `#da3633`    |
| RENAMED    | `R`          | blue   `#2f81f7`    |
| CONFLICT   | `C`          | orange `#fb8500`    |
| RESOLVED   | `✓`          | purple `#8957e5`    |
| CURRENT    | (none)       | (none)              |
| DIRECTORY  | folder icon  | (theme neutral)     |

(Color hex literals observed in bundle palette block near the overlay
definitions. Match GitHub's status palette — intentional convention.)

Badge dimensions: 12 × 12 px, font-weight 600.

## File-level diff stat (`+N/-M`)

Each row shows a mini diffstat next to the status badge:

```
+{added_lines}  /  -{removed_lines}
```

Colored: added green, removed red. When a file is `BINARY` the stat
is replaced with `"bin"`.

Counter strings:

```
CommitDiffSection-DateByAuthorName = "{0} by {1}"
```

Header format "today by Lobinux" for per-commit section headers in
multi-commit view.

## Rename detection

GitKraken uses git's own rename detection (`-M` flag on diff). When
detected, the row renders as:

```
old/path/to/file.ext → new/path/to/file.ext
```

(Arrow U+2192.) Similarity percentage is **not** shown — GitKraken
omits this detail even though git provides it.

No explicit threshold — inherits git's default `-M` (50% similarity).

## Staging indicator

In working-directory view, each row gets a small dot or checkmark
indicating stage state:

- **Unstaged**: empty circle (outline).
- **Staged**: filled circle (accent color).
- **Partially staged**: half-filled circle (some hunks staged).

The partial-stage detection requires per-hunk inspection — implemented
by comparing file index entries to the working-tree content.

## Conflicted-files section

When the repo is mid-merge/rebase and has conflicts, the file list
splits into sections with titles from:

```
UncommittedFileList-ConflictedFilesTitleSummary     = "Conflicted Files ({0})"
UncommittedFileList-StagedFilesTitleSummary         = "Staged Files ({0})"
UncommittedFileList-UnconflictedFilesTitleSummary   = "Resolved Files ({0})"
UncommittedFileList-UnstagedFilesTitleSummary       = "Unstaged Files ({0})"
```

Each is a collapsible section with its own count badge in the header.

## Yryvu implications

- **Use the `types` enum 1:1**. Don't add COPIED or TYPECHANGE as
  distinct values — they collapse into ADDED / MODIFIED per git's
  simplification.
- **Separate `fileDataTypes` enum** for content-rendering decisions.
  `BINARY`, `IMAGE`, `SUBMODULE`, `DIRECTORY`, `DELETED`, `TEXT`.
- **Match GitHub's status palette** for colors — the user transfers
  glance-meaning from GitHub/GitLab/Bitbucket.
- **Arrow rename notation** (`old → new`) without similarity pct.
- **Tri-state staging indicator** — outline / filled / half-filled.
- **Sectioned file list** when conflicts present — four sections max
  (Conflicted / Resolved / Staged / Unstaged).
- **No COPIED badge** — git's copy detection is opt-in (`--find-copies`
  flag), and GitKraken leaves it off. Yryvu follows suit unless the
  user explicitly enables it in preferences.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `at\.types=\{ADDED:"added"` — status enum definition.
- `fileDataTypes=\{BINARY:"BINARY"` — content-kind enum.
- `CommitDiffSection-File(Added|Deleted|Modified|Renamed)` — label keys.
- `UncommittedFileList-(Conflicted|Staged|Unconflicted|Unstaged)FilesTitleSummary` — section headers.
- `FileContentsPanel-Binary` — binary placeholder.
