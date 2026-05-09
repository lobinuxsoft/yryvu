# Whitespace handling + diff algorithm

GitKraken exposes exactly **one whitespace toggle** — "Ignore
Leading/Trailing Whitespace" — and **does not** expose a diff
algorithm selector. The underlying diff is computed by `git` /
`NodeGit` / Monaco with their defaults; users get no `myers` /
`patience` / `histogram` choice.

## Ignore-whitespace toggle

Single toggle in the diff toolbar:

| Button ID                    | Label key                          | Icon                  | State |
|------------------------------|------------------------------------|----------------------|-------|
| `ignore-whitespace-button`   | `FileViewPanel-IgnoreWhiteSpace`   | `["far","paragraph"]`  | Active when `ignoreWhitespace === true` |

Label value (important):

```
FileViewPanel-IgnoreWhiteSpace = "Ignore Leading/Trailing Whitespace"
```

**It's specifically leading/trailing**, not ALL whitespace. This maps
to Monaco's:

```js
ignoreTrimWhitespace: boolean
```

(Monaco's name is `ignoreTrimWhitespace` — "trim" is leading+trailing.
Git's `-w` flag ignores ALL whitespace; that's a different thing and
GitKraken doesn't expose it.)

## Wiring

From doc 01:

```js
// buildDiffOptions():
{
  ...,
  ignoreTrimWhitespace: this.props.ignoreWhitespace,
  ...
}
```

Toggle state persists per-profile alongside view mode (path
`ui.diffView.ignoreWhitespace` or similar — not confirmed).

## What about `git -w`?

Not exposed. If the user wants to ignore all whitespace (collapse
runs of spaces, ignore blank lines, etc.), they have to change
global Git config or use external tools.

This is a deliberate simplification — "Ignore leading/trailing" handles
99% of noise from editor settings (final-newline differences,
trailing-whitespace stripping). Aggressive `-w` can mask real bugs
(indentation-sensitive languages like Python).

## Diff algorithm — no selector

Searches in the bundle for `diffAlgorithm`, `patience`, `histogram`,
`myers` produce NO matches. Conclusion: GitKraken uses the **default
algorithm** of whichever engine generates the diff:

- **NodeGit / git binary path**: uses git's default, which is `myers`
  (or `histogram` if the user has `diff.algorithm = histogram` in
  their `.gitconfig`).
- **Monaco's own diff** (for in-editor comparisons): uses Monaco's
  built-in algorithm (a variant of Myers with optimizations).

User can still change `diff.algorithm` in their global or per-repo
`.gitconfig`; GitKraken honors it passively. But no UI toggle.

## Word wrap — separate concern

The `Word Wrap` toolbar button is a display option, not a diff option.
It toggles Monaco's `wordWrap` between `"on"` and `"off"`.

```
FileViewPanel-WordWrap = "Word Wrap"
EditorPreferences-WordWrap = "Word Wrap"
```

Two entry points: the toolbar (transient for current file) and
Editor preferences (default for all files). The toolbar override
applies only to the current file and resets on next-file open.

Persistence: the preferences value is per-profile; the toolbar
override is session-scoped.

## Tab rendering

Tab size is **per user preference**, applied via model option:

```js
mn.updateOptions({ tabSize: ct });
```

(Per doc 04.) No per-file-type tab size override in the bundle.
`.editorconfig` is NOT honored by GitKraken — audit opportunity for
Yryvu (#33 capability audit).

## Yryvu implications

- **One whitespace toggle only**: "Ignore Leading/Trailing Whitespace"
  → Monaco `ignoreTrimWhitespace`. Do not expose `-w` or aggressive
  whitespace-ignore — follow GitKraken's simplification.
- **No algorithm selector**. If user wants `patience` / `histogram`,
  they set it in `.gitconfig`. `gix` and `git2-rs` honor `diff.algorithm`
  automatically.
- **Word Wrap is a display toggle**, not a diff option. Per-file
  override (toolbar) overlays per-profile default (preferences).
- **Tab size per-profile**, not per-file. `.editorconfig` support is
  a post-clone Yryvu innovation.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `ignore-whitespace-button` — toolbar button ID.
- `FileViewPanel-IgnoreWhiteSpace` — label key.
- `ignoreTrimWhitespace:this\.props\.ignoreWhitespace` — Monaco option.
- `FileViewPanel-WordWrap` — word-wrap button.
- No matches for `diffAlgorithm`, `patience`, `histogram`, `myers` —
  confirms absence of selector.
