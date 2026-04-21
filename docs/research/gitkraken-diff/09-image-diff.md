# Image diff — side-by-side with single overlay toggle

When a file is classified as `fileDataTypes.IMAGE` (doc 06), the diff
viewer renders a **side-by-side pair** (old left, new right) with an
optional **overlay** toggle that superimposes the old image on the
new.

This is simpler than the four-mode image diff (side-by-side / onion /
difference / slider) that an earlier Chajá audit assumed. The GitKraken
reality is **two controls**: the always-present side-by-side pair
plus a single "Show diff overlay" button.

## Strings

```
DiffImage-OldImage           = "Old image"
DiffImage-NewImage           = "New image"
DiffImage-ShowDiffOverlay    = "Diff overlay old image"
Merge-NoImage                = "No image"
```

`Merge-NoImage` covers cases where one side doesn't exist (pure
addition or deletion of an image file).

## Layout

```
+--------------------------+--------------------------+
| Old image       [label]  | New image       [label]  |
|                          |                          |
|     [rendered img]       |     [rendered img]       |
|                          |                          |
|                          |     [🌓 overlay toggle]  |
+--------------------------+--------------------------+
```

The overlay button (tooltip: "Diff overlay old image") flips a state
that renders the old image as a semi-transparent layer on top of the
new. No alignment slider, no animation — pure toggle.

## Detection

A file is classified as `IMAGE` when its extension matches one of:

```
.png  .jpg  .jpeg  .gif  .webp  .svg  .bmp  .tiff  .ico
```

Also detected by MIME from server responses for HTTP-sourced content.

Observed MIME strings in bundle: `image/bmp`, `image/gif`, `image/jpeg`,
`image/png`, `image/svg`, `image/tiff`, `image/vnd`, `image/webp`, `image/x`.

## Content loading

Images are loaded as **blob URLs** from the git object database:

```js
// pseudocode
const blob = await repo.readBlob(oid);
const url = URL.createObjectURL(new Blob([blob.content], {type: mime}));
imgElement.src = url;
URL.revokeObjectURL(url);  // on unmount
```

Same pattern for both original (parent tree) and modified (working tree
or target tree) versions.

## Additions and deletions

- **Pure addition** (no original): old panel shows `Merge-NoImage`
  placeholder, new panel shows the image.
- **Pure deletion**: new panel shows placeholder, old panel shows the
  image.
- **Both missing** (invalid state): both placeholders.

## Zoom / pan

Not observed in Round 3 pass. The image panels don't appear to expose
zoom controls — relies on natural image size. For large images, the
browser's default `<img>` fit behavior handles it (browser-controlled
scaling).

Verify in future research pass if zoom is present under an icon button
not captured here.

## SVG handling

`image/svg+xml` is rendered directly (the SVG source is the image).
Because SVG is XML text, it could technically render as a text diff —
GitKraken chooses to render it visually, matching the user's mental
model ("an SVG is an image").

Clicking a context-menu option could force text-diff view for SVGs,
but no such option observed. Research pass for context menus needed.

## Binary image files over 50 MB

Covered by doc 07's large-file handling. A huge PNG (> 50 MB) triggers
the binary placeholder, not the image viewer.

## Chajá implications

- **Two controls total**: always-visible side-by-side pair + overlay
  toggle. Do not invent onion-skin, slider, difference modes unless
  post-clone.
- **Blob URLs** for source — mirror GitKraken's lifecycle (revoke on
  unmount).
- **"No image" placeholder** for missing side in add / delete scenarios.
- **Natural image sizing** — no zoom controls in clone scope.
- **SVG renders as image** by default. Text-diff fallback could be a
  post-clone affordance.
- **Standard extension allowlist** from GitKraken's observed MIME set.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `DiffImage-(OldImage|NewImage|ShowDiffOverlay)` — UI labels.
- `Merge-NoImage` — missing-side placeholder.
- `"diff-overlay-tooltip"` — tooltip ID for the overlay button.
- `fileDataTypes\.IMAGE` — classification path.
- `image/(bmp|gif|jpeg|png|svg|tiff|webp)` — MIME allowlist.
