# Misc filetypes — submodule pointers, directories, absent types

Round 3 closed the per-filetype matrix. Beyond text (Monaco — doc 01),
markdown (preview — doc 08), image (viewer — doc 09), and binary
(placeholder — doc 10), three additional cases appear in the enum:
`SUBMODULE`, `DIRECTORY`, and `DELETED`. Everything else folds into
one of the four primary categories.

Notably **absent** from GitKraken's bundle despite their presence in
other Git clients:

- **Jupyter notebooks** (`.ipynb`) — no specialized JSON/notebook cell
  renderer. `.ipynb` files are treated as JSON text and render in
  Monaco with JSON syntax highlighting. Comparing a 1000-cell notebook
  shows raw JSON diff, noise and all.
- **CSV / TSV** — no tabular viewer. CSV files are plain text in Monaco.
- **PDF** — no PDF preview. Classified as BINARY, shows "Binary file"
  placeholder.
- **LaTeX** — no rendered preview. Plain text.

Chajá inherits these gaps per the 1:1 rule. Post-clone, specialized
viewers can be added.

## Submodule pointer view (`fileDataTypes.SUBMODULE`)

A submodule entry in a tree is stored as a commit OID reference, not
an actual file content. Rendering shows the before/after commit
information:

Layout (approximate, needs further research for exact pixel layout):

```
+-----------------------------------------+
|  Submodule: {submodule-name}            |
|                                         |
|  Old commit: {oid} — {short message}    |
|  New commit: {oid} — {short message}    |
|                                         |
|  [Open submodule]  [Show submodule log] |
+-----------------------------------------+
```

Strings observed:

```
Submodule                                     = "Submodule"
submodule                                     = "submodule"
Submodule-CloningInto                         = "Cloning into {0}"
Submodule-CheckingOut                         = "Checking out submodule {0}"
Submodule-CommitMessageDeleted                = "Removed submodule {0}"
Submodule-CommitMessageNew                    = "Added submodule {0}"
Submodule-CannotStageUncommittedSubmoduleChanges = "You have uncommitted changes on your submodule. Open the submodule to commit changes."
```

The "Open submodule" action opens the submodule as a new tab in the
same window (existing tab infrastructure from #39).

## Directory pseudo-entries (`fileDataTypes.DIRECTORY`)

In tree mode of the file list, directories are rows without file
content. They expand / collapse their children. Clicking a directory
row toggles its accordion state (action
`TreeViewDirectoryAccordionToggle` per doc 05).

No diff content for directories — they exist only to group file rows.

## Deleted files (`fileDataTypes.DELETED`)

When a file is deleted, the diff viewer shows the **pre-deletion
content** with a delete-indicator overlay banner:

```
This file was deleted.
```

Monaco renders the content as the "original" side, nothing as
"modified". Monaco's standard delete-diff rendering (all lines as `-`
in inline mode, original column filled / modified column empty in
split mode).

## Git LFS pointer files

Per doc 07, LFS pointer files get a specialized placeholder:

```
LFS object (12.4 MB)
[ Download ]
```

Not a separate `fileDataTypes` value — detection is a post-load check
that the content starts with `version https://git-lfs.github.com/spec/v1`.
If so, the pointer metadata is parsed and the UI switches to the LFS
placeholder regardless of what `fileDataTypes` classified the file as.

## .gitignore, .gitattributes special UI?

**None observed.** These files render as plain text in Monaco without
specialized syntax highlighting beyond what Monaco's built-in grammar
provides (which may or may not include `.gitignore`). No dedicated
viewer or form editor.

## Package manifest special UI? (`package.json`, `Cargo.toml`, etc.)

**None observed.** Monaco handles JSON / TOML syntax highlighting; no
dedicated manifest editor view.

## Chajá implications

- **Four primary renderers** + three edge enum values (SUBMODULE /
  DIRECTORY / DELETED) cover the whole surface.
- **Submodule pointer view** is a light specialized pane — worth
  implementing for #98 submodules issue.
- **Directory rows** are tree-mode-only list nodes, no diff content.
- **Deleted files** use Monaco's default delete-diff rendering.
- **LFS pointer placeholder** in #21 Git LFS issue.
- **No specialized viewers** for notebook / CSV / PDF / LaTeX in clone
  scope.
- **No specialized manifest UI** (`package.json` editor, etc.).

## Post-clone opportunities (out of scope now)

These are features GitKraken **doesn't** have that Chajá could add as
chajá-innovation after the clone is complete:

- Notebook cell-level diff for `.ipynb`.
- CSV tabular diff with cell-level highlighting.
- PDF diff (pdfjs render + visual diff).
- Manifest-aware dependency diff (npm / cargo / pip).

Logged here so the capability audit #33 has these on the backlog.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `fileDataTypes\.(SUBMODULE|DIRECTORY|DELETED)` — enum branches.
- `Submodule-(CloningInto|CheckingOut|CommitMessage(Deleted|New)|CannotStageUncommittedSubmoduleChanges)` — submodule strings.
- No matches for `ipynb`, `CSV`, `PDF`, `LaTeX` — confirming the absence.
