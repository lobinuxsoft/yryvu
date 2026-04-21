# Word-level (intra-line) diff

GitKraken's intra-line change highlighting — the feature that colors
only the changed *spans* within a modified line rather than the whole
line — is **delegated entirely to Monaco**. No custom tokenizer or
char-diff algorithm is run in the render bundle.

## Monaco's `charChanges`

`ILineChange` from Monaco's `getLineChanges()` (see doc 03) includes
an optional `charChanges` array:

```ts
interface ILineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
  charChanges?: ICharChange[];
}

interface ICharChange {
  originalStartLineNumber: number;
  originalStartColumn: number;
  originalEndLineNumber: number;
  originalEndColumn: number;
  modifiedStartLineNumber: number;
  modifiedStartColumn: number;
  modifiedEndLineNumber: number;
  modifiedEndColumn: number;
}
```

Each `ICharChange` pinpoints a contiguous character span on each side
that differs. Monaco renders these spans with darker background than
the whole-line tint.

## Rendering decoration

GitKraken does nothing beyond setting `renderIndicators: true` on the
diff editor (default). Monaco paints:

- **Changed line background** — lighter tint using
  `diffEditor.insertedLineBackground` / `diffEditor.removedLineBackground`
  theme tokens.
- **Changed span background** — darker tint using
  `diffEditor.insertedTextBackground` / `diffEditor.removedTextBackground`.

The two-level tint produces the "changes within a change" effect at
zero additional cost.

## Enable/disable — there is no toggle

No "word-level diff on/off" option in GitKraken. It's always on when
Monaco has `charChanges` available, which is its default. The user
cannot disable the intra-line highlight.

## Algorithm

Monaco's `charChanges` algorithm is part of Monaco's own diff engine
— a combination of LCS-based line diffing followed by token-level
Myers for the character ranges within each changed line. GitKraken
uses it unmodified.

Fine detail: Monaco computes `charChanges` only for line pairs that
are heuristically "similar enough" — very different replacement lines
(e.g., full rewrite) omit `charChanges` and render the whole line as
changed without inner span highlighting. The similarity threshold is
internal to Monaco.

## Theme tokens

Mapped to standard Monaco tokens; GitKraken's theme JSON defines these:

```
diffEditor.insertedTextBackground    — changed span on modified side
diffEditor.removedTextBackground     — changed span on original side
diffEditor.insertedLineBackground    — whole-line tint (lighter)
diffEditor.removedLineBackground     — whole-line tint (lighter)
```

For a light theme, typical values: span ~40% opacity green/red, line
~15% opacity of the same. For dark: similar opacities on the darker
base.

## Interaction with ignore-whitespace

When `ignoreTrimWhitespace` is on (doc 13), Monaco recomputes
`charChanges` ignoring leading/trailing whitespace changes. A line
whose only difference is trailing whitespace shows as *unchanged* —
no line tint, no span tint. This is consistent across the view modes.

## No word-diff in hunk view headers

The hunk-header text (`@@ -N,M +A,B @@`) is not rendered by Monaco in
hunk view (it's replaced with the overlay widgets from doc 12).
Word-level highlighting inside hunk body lines works identically to
inline/split modes — it's a model-level property, not a mode-level
one.

## Chajá implications

- **Use Monaco's `charChanges` directly** — no custom intra-line diff
  library needed (no `diff-match-patch`, no `jsdiff`, no Hirschberg).
- **Define the four `diffEditor.*` theme tokens** in Chajá's Monaco
  theme JSON. Use standard Monaco opacities as starting point.
- **No user toggle for word-level highlighting** — always on.
- **No chajá-specific word-diff algorithm**. Monaco's is sufficient
  and battle-tested.
- **Interaction with `ignoreTrimWhitespace` is free** — Monaco handles
  the recomputation.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `renderIndicators` — the one Monaco option directly touching inline
  change rendering (GitKraken sets it via default).
- `getLineChanges` — API consumer (doc 03).
- No matches for `charDiff`, `diff-match-patch`, `jsdiff`, `hirschberg`
  — confirming delegation to Monaco.
