# 06 — Editor font

## Bundle reality: GK has it, in the EDITOR panel not UI panel

GK's editor font lives in `Preferences > Editor > Font`. Source:
`bundle:255739-255774`. Two settings on adjacent rows:

| Row | Bundle | Persistence path |
|---|---|---|
| Font | `bundle:255749` `EditorPreferences-Font` | `["editor", "fontFamily"]` (`bundle:10632`, `bundle:255589`) |
| Font Size | `bundle:255753` `EditorPreferences-FontSize` | `["editor", "fontSize"]` (`bundle:255685`) |

The font row uses `ReactSelectGK` (a searchable react-select wrapper)
populated from `fontOptions`, derived asynchronously from the system's
font list (`bundle:255596` `areFontsLoading`, `bundle:255596`
`fontOptions`). This is `Electron`-specific: `electron.systemPreferences`
or `font-list` npm package enumerates installed fonts at startup.

The font dropdown also has a **Show only monospace** checkbox below
it (`bundle:255724-255738`):

```js
{
  label: t("EditorPreferences-ShowOnlyMonospace"),
  checked: !showProportionalFonts,
  // toggle ["ui", "showProportionalFonts"]
}
```

This is interesting — note the persistence path is `["ui",
"showProportionalFonts"]` (in the `ui` slice), not `["editor",
"showProportionalFonts"]`. The flag is a UI filter on the font picker
and persists across editor + CLI font pickers (used at `bundle:370614`
too).

### Other rows on the EDITOR panel

For completeness:

| Row | Bundle | Path |
|---|---|---|
| Font | `bundle:255749` | `["editor", "fontFamily"]` |
| Font Size | `bundle:255753` | `["editor", "fontSize"]` |
| Tab Size | `bundle:255757` | `["editor", "tabSize"]` |
| EOLCharacter | `bundle:255761` | `["editor", "lineEnding"]` |
| Syntax Highlighting | `bundle:255765` | `["editor", "syntaxHighlighting"]` |
| Show Line Numbers | `bundle:255769` | `["editor", "showLineNumbers"]` |
| Word Wrap | `bundle:255773` | `["editor", "wordWrap"]` |

These are all editor-config concerns, not UI-look concerns. They're
out of #103 scope.

## chajá triage: DEFER all editor settings

chajá has no built-in editor (Monaco / CodeMirror) yet. The diff
viewer is in cluster #257 (`gitkraken-diff` research). Until that
ships, none of these settings have a render target.

**Decision**: defer **all** editor settings to a future
`feat(preferences): editor preferences` issue that lands alongside the
diff editor cluster.

The chajá `Preferences > UI` panel is "look of the chajá UI", not
"editor config". Mixing them is GK's accident-of-history (they group
`fontFamily` under `editor` but have a `showProportionalFonts` toggle
under `ui` because the font picker is also reused by the CLI panel).

### What about the chajá UI font?

chajá's UI font is fixed: `system-ui, -apple-system, "Segoe UI", Roboto,
sans-serif` for chrome, FiraCode Nerd Font Mono for any mono context.
There's **no user setting** to change either. Justification:

1. Chrome font matters for OS feel — overriding `system-ui` breaks
   that. Users who want a different system font change it OS-wide.
2. Mono font is bundled (FiraCode Nerd Font Mono v3.4.0, ~7.7MB) for
   ligature consistency + Nerd-Font icon glyph access. Allowing the
   user to override it defeats the consistency guarantee for icon
   PUA codepoints.

If user demand surfaces post-#103 ("I want JetBrains Mono in the
sidebar"), file follow-up. **Not a v1 concern.**

## Cross-validation

Re-grepped:

```
$ grep -n "EditorPreferences-Font" /tmp/gk-bundle-pretty.js
255749:                        label: hr("EditorPreferences-Font")
255753:                        label: hr("EditorPreferences-FontSize")
$ grep -n "editor.*fontFamily" /tmp/gk-bundle-pretty.js | head -3
10632:                    path: ["editor", "fontFamily"]
49002:                            path: ["editor", "fontFamily"]
240788:                            path: ["editor", "fontFamily"]
$ grep -n "showProportionalFonts" /tmp/gk-bundle-pretty.js | head -3
235001:                            showProportionalFonts: !1,
255559:                            path: ["ui", "showProportionalFonts"]
370614:                    path: ["ui", "showProportionalFonts"]
```

All citations confirmed.

## Triage

**DEFER (chajá editor not shipped)**. File follow-up issue once
diff/edit-in-place editor cluster lands. Do NOT add a font picker to
the chajá UI preferences panel.
