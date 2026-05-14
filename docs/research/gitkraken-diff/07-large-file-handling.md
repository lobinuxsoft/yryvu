# Large file handling — thresholds, placeholders, fetch-on-demand

GitKraken caps the effective diff size via a **50 MB stdout buffer**
when invoking `git` as a subprocess. Files whose content or diff
exceeds this cap fall back to placeholder UI that lets the user
decide whether to force-load.

## The 50 MB stdout cap

Observed constant in the bundle:

```js
const oa = 52428800;  // 50 * 1024 * 1024
Rn && Dr.stdout && Dr.stdout.on(/* ... */);
```

Context is a spawned-process (`Dr.stdout`) pipe handler. When the
accumulated output crosses `oa`, the process is killed and the UI
surfaces a "file too large" fallback. Strings observed:

```
ErrorMessage-ChunkHeaderFailure = "Failed to write chunk header for {0}: this might indicate a file is too large."
```

This is a diff-layer cap, not a source-file cap. A 60 MB text file
with a 10-line patch still works because the **diff output** stays
small. Only when the diff itself (context + patch) exceeds 50 MB does
the cap trigger.

## Placeholder UI — "Binary file" as the catch-all

Strings referenced when content rendering is suppressed:

```
FileContentsPanel-Binary = "Binary file"
Merge-BinaryFile         = "Binary File"
```

Despite the label, this placeholder fires in multiple scenarios:

1. Actual binary file (per `fileDataTypes.BINARY` — detected via
   null-byte scan or `.gitattributes`).
2. File too large (> 50 MB diff or > configurable threshold).
3. LFS pointer file (shows "LFS object (N KB)" variant).
4. Content fetch failed (network / permission error).

The UI is the same flat "Binary file" pane with optional action buttons
("Open in external tool", "Download full" for LFS).

## Fetch-on-demand pattern

For large non-binary files, GitKraken does NOT auto-load the full diff.
Instead:

- Row shows as usual in the file list with its `+N/-M` stat.
- Clicking the row shows the placeholder pane with a "Show anyway"
  button.
- Clicking "Show anyway" retries the diff with the cap bypassed (or
  larger cap), streaming into Monaco progressively.

This avoids the common trap of a huge file freezing the app on
casual click-through.

No explicit string `"Show anyway"` found — the button uses a generic
"Load full file" or "Show content" label. Research incomplete on exact
label.

## Per-file-type size thresholds

Beyond the hard 50 MB cap, there's no per-file-type soft threshold in
the render bundle. Monaco handles line-count performance internally
(> 10,000 lines triggers its own optimizations). GitKraken relies on
Monaco for line-count limits rather than imposing their own.

## Warning banner for near-cap files

When a file's diff is large but under the cap (e.g., 10-50 MB range),
GitKraken shows a warning banner before loading:

```
"This file is large. Loading may take a moment."
```

(Approximate — couldn't find exact key in first pass.) The banner does
not prevent load, just warns.

## Binary detection heuristic

For content kind classification (before deciding BINARY vs TEXT):

1. Null-byte scan on first 8 KB of content.
2. `.gitattributes` with `-diff` or `binary` explicit override.
3. Known binary extensions whitelist (`.png`, `.jpg`, `.pdf`, ...).

Matches git's own heuristic (`git diff` applies the same rules).

## LFS pointer file handling

LFS pointer files (~150 bytes containing the hash) are detected via:

1. First line starts with `version https://git-lfs.github.com/spec/v1`.
2. OR presence in `.gitattributes` with `filter=lfs`.

Rendered with specialized placeholder:

```
LFS object (12.4 MB)
[ Download ]   [ View content (download + open) ]
```

Download is streaming; file size shown from pointer metadata. See #21
(Git LFS support) for the full integration.

## DirectoryReadErrorTimeout

Observed error constant `DirectoryReadErrorTimeout`. When directory
listing takes too long (e.g., monorepo with 100k+ files), surfaces a
fallback. Threshold not captured; requires further research.

## Yryvu implications

- **Adopt the 50 MB diff cap** — mirrors GitKraken and matches typical
  git limits. Configurable in Experimental preferences (#107) for users
  with genuinely huge repos.
- **Placeholder UI for all three skip-render cases** — binary, too-large,
  LFS pointer. Reuse the same pane with a label switch ("Binary file",
  "File too large", "LFS object") plus appropriate action buttons.
- **Fetch-on-demand for large files** — show stat + placeholder, load
  on click of "Show anyway" button.
- **Warn at 10 MB+, cap at 50 MB** — or make both configurable.
- **Binary detection = null-byte scan + `.gitattributes` override +
  extension allowlist**. `gix` exposes the content-kind classification
  directly — prefer that over rolling our own.
- **Monaco handles line-count perf** — don't impose our own line cap
  unless profiling shows a specific bottleneck.
- **No "Show anyway" button label confirmed yet** — flag for research
  Round 3 if we capture the exact key during image/binary deep dive.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `52428800` — the 50 MB constant (search for other occurrences; may
  appear as `50*1024*1024` or literal).
- `FileContentsPanel-Binary` — placeholder string key.
- `ErrorMessage-ChunkHeaderFailure` — too-large error surfacing.
- `DirectoryReadErrorTimeout` — directory listing timeout.
- `fileDataTypes.BINARY` — content classification.
- `git-lfs.github.com/spec/v1` — LFS detection regex.
