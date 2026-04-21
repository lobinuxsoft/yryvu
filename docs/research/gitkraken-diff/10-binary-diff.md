# Binary diff — placeholder-only pattern

Binary files are detected and routed to a single placeholder pane
labeled "Binary file". **No hex viewer** was found in the bundle —
GitKraken does not offer a hex-dump diff for arbitrary binaries.

## Strings

```
FileContentsPanel-Binary     = "Binary file"
Merge-BinaryFile             = "Binary File"
```

Different capitalization — first is for the plain file viewer,
second is used inside the conflict resolver during a merge with
binary conflicts.

## Classification

Per doc 06, `fileDataTypes.BINARY` fires when:

1. Null-byte scan on first 8 KB of content detects binary-like bytes.
2. `.gitattributes` declares `-diff` or `binary` for the path.
3. Known binary extension allowlist (shared with image detection;
   images are the binary subtype that DOES get a viewer).

## Placeholder anatomy

The "Binary file" pane is minimal:

- Centered label text.
- Optional file size (when known).
- For working-directory view with staging enabled: "Stage filemode"
  button when only the file's executable bit changed (string
  `FileViewPanel-DiffFileMode` = "File Mode Changes from {0} to {1}").

No hex viewer, no offset / length controls, no byte diff. If the user
wants to inspect the binary, they use an external tool (see Tool
preferences — doc not covered here, ticketed as #105).

## File mode changes

When a binary file's only change is the executable permission, the
placeholder shows:

```
File Mode Changes from 100644 to 100755
[Stage filemode]
```

Counter strings:

```
FileViewPanel-DiffFileMode                = "File Mode Changes from {0} to {1}"
Error-StageFilemodeFailed                 = "Could not stage filemode for {0} for the following reason: {1}"
Error-UnstageFilemodeFailed               = "Could not unstage filemode for {0} for the following reason: {1}"
```

Filemode staging is distinct from content staging — the UI explicitly
separates them.

## Binary-conflict handling

During a merge with binary file conflicts, the 3-pane conflict resolver
(doc 18 from graph research — not implemented yet) shows `Merge-BinaryFile`
in all three panes. Resolution is "Take ours" / "Take theirs" — no
middle-pane merge possible for binary.

## Size limits

Binary files over the 50 MB cap (doc 07) are also handled by the
"Binary file" placeholder. The user sees the same pane regardless of
whether the file is classified as binary content OR too-large text.

## Chajá implications

- **Single placeholder pane** for all binary cases. No hex viewer in
  clone scope — post-clone innovation if desired.
- **"File mode change" affordance** — specialized content for that
  specific case, even in the binary pane.
- **Filemode staging is a separate action** from content staging. Wire
  both in #2 hunks + filemode staging.
- **Binary-conflict = ours/theirs only** (no content merge).
- **Size-limit and binary share the placeholder** — label switch only.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `FileContentsPanel-Binary` — plain binary placeholder.
- `Merge-BinaryFile` — conflict-resolver binary placeholder.
- `FileViewPanel-DiffFileMode` — file mode change affordance.
- `Error-(Stage|Unstage)FilemodeFailed` — filemode staging error paths.
- `fileDataTypes\.BINARY` — classification branch.
