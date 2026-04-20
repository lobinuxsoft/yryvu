# Theme system

GitKraken supports multiple visual themes — at minimum light, dark, and
a high-contrast variant — and persists the choice per user profile
rather than per machine. The bundle shows a layered system: a **theme
runtime** in the React render process that compiles a theme definition
into CSS custom properties injected into the document, a **Monaco
editor bridge** that mirrors the same palette to the embedded code
editor, and a **deprecated custom-theme path** that is being phased
out in favour of a curated built-in set.

## Theme switcher UI

Reachable from preferences and from an inline picker. The picker side
is driven by `getSwitchThemeItems` / `getSwitchThemeItemsForFilter` /
`sortThemeOptions` / `getNotCurrentThemeOptions`, with labels
`SwitchTheme` / `SwitchThemePlaceholder`. A fuzzy-filtered list of
theme options (`themeOptions`, `getAvailableThemeOptions`) reusing the
global filter pattern. The preferences-panel route uses the same
state via `getCurrentProfileUiTheme`.

## Built-in themes

`isBuiltInTheme` and the constants `darkTheme` / `lightTheme` /
`defaultTheme` / `appThemes` confirm an enumerated set of curated
themes. `getHighContrastColorForTheme` implies a high-contrast overlay
applied on top of a base theme rather than a fully separate theme file
— useful for accessibility without doubling the theme count.

OS follow: `getOSTheme` / `osTheme` / `currentThemeScheme` /
`themeSchemeTypes` / `isLightTheme` / `isCurrentThemeSchemeLight` /
`getCurrentThemeScheme` track whether the *effective* theme should
follow the OS light / dark preference.

## Data structure

A theme is compiled into a `themeDict` (a flat key → colour object)
and applied via CSS custom properties. Evidence: `cssVariables`,
`cssVariablesWithDefaults`, `getCssVariables`, `buildResizableCssVars`,
and the many `--color-*` custom properties found in the bundle string
table:

- `--color-graph-scroll-marker-local-branches`
- `--color-graph-scroll-marker-remote-branches`
- `--color-graph-scroll-marker-pull-requests`
- `--color-graph-scroll-marker-upstream`
- `--color-graph-scroll-marker-selection`
- `--color-graph-scroll-marker-stashes`
- `--color-graph-scroll-marker-tags`
- `--color-graph-scroll-marker-highlights`

The pattern is VS Code-like: one set of semantic variable names,
multiple palettes overriding them.

Compiled result cached: `currentCompiledTheme` and
`currentCompiledThemeString` hold the parsed object and its serialised
CSS text respectively, while `_themeStyleElement` is the single
`<style>` node where the CSS text is written.

## Application path

`setTheme` / `_setTheme` / `setThemeSaga` / `applyMonacoTheme` /
`setCurrentTheme` / `defineTheme` / `getTheme` / `getThemeDict` /
`getCurrentCompiledTheme` / `getCurrentCompiledThemeString` form the
pipeline. `useTheme` is the React hook. `ThemeContext` / `ThemeProvider`
/ `_themeService` / `ThemeService` are the wiring.

Runtime colour resolvers: `themeOpacityFactor`,
`getThemeOpacityFactor`, `ckgroundColorFromColorAndTheme`,
`regroundColorFromColorAndTheme` — some colours are computed at
runtime based on the theme scheme rather than stored flat.

## Live reload

Switching themes does **not** restart the app. `setThemeSaga`
recompiles `currentCompiledTheme`, rewrites
`_themeStyleElement.textContent`, and dispatches `applyMonacoTheme`
to update the editor in-place. Components re-render via
`ThemeContext` / `useTheme`. `prevTheme` is the previous-state
snapshot used for diffing so that unrelated DOM does not thrash.

## Persistence

`getCurrentProfileUiTheme` proves persistence is **profile-scoped**,
not machine-scoped — multiple profiles on the same machine can hold
different themes. This matches the credential model (doc 22). The
`themeId` is a string stored in the profile preferences blob.

## Monaco / diff viewer integration

The diff viewer uses Monaco. `applyMonacoTheme` /
`getMonacoEditorTheme` / `monacoEditorTheme` bridge the GitKraken
theme to Monaco's own theme API. Because Monaco has its own
token-colour concept, GitKraken registers a Monaco theme whose colours
are derived from the GitKraken `themeDict` rather than shipping two
independent definitions. Graph and tree views share the same CSS
custom properties directly — no bridge needed.

## Custom themes (deprecated)

`buildCustomThemeDeprecationNotice`, `CustomThemeDeprecationNotice`,
`CustomThemeDeprecationNoticeMessage`,
`CustomThemeDeprecationNoticeOpenPref`,
`CustomThemeDeprecationNoticeTitle`, `showCustomThemeDeprecationToast`,
`showCustomThemeDeprecationToastSaga` — GitKraken **used** to support
user-authored theme files, and the bundle still carries a toast that
appears at startup if a user has one configured, urging them to
switch to a built-in theme. No active loader for user themes remains
in the render bundle; the feature is on its way out.

## Analytics

`getCurrentThemeSchemeForAnalytics` sends the current scheme
(dark / light / hc) to the analytics pipeline (presumably to inform
which built-in themes get maintained).

## Algorithm (pseudocode)

```
saga setTheme(themeId):
    profile.uiTheme = themeId                     # getCurrentProfileUiTheme
    def  = getTheme(themeId)                      # built-in lookup
    dict = getThemeDict(def)                      # flat {var -> colour}
    css  = Object.entries(dict)
             .map([k,v] => `--color-${k}: ${v};`)
             .join("\n")
    css  = `:root { ${css} }`
    _themeStyleElement.textContent = css          # live reload
    currentCompiledTheme       = dict
    currentCompiledThemeString = css
    applyMonacoTheme(getMonacoEditorTheme(dict))  # editor
    dispatch ThemeChanged(themeId)                # useTheme re-renders

function getCurrentThemeScheme():
    if profile.followOS:
        return getOSTheme()                       # 'light' | 'dark'
    return themeSchemeTypes[getTheme(profile.uiTheme).scheme]
```

## Chajá implications

- **Use the exact model**: one flat dictionary of semantic tokens,
  rendered as CSS custom properties on `:root`, swapped by rewriting
  a single `<style>` node.
- **Persist per profile**, not per machine.
- **Do NOT open the door to user-authored theme files** — GitKraken
  tried it, is dragging users off it with a deprecation toast, and
  the support burden (broken themes after a variable rename) is the
  reason.
- **Derive the editor theme** (Monaco / CodeMirror for the diff
  viewer) from the same dictionary so a single change propagates.
- **Add a "follow OS" toggle from day one** via
  `matchMedia('(prefers-color-scheme: dark)')` — users on
  auto-switching desktops expect it.
- **Record the analytics scheme** (`light` / `dark` / `hc`) but
  never the theme ID itself, for privacy.
- **Complements doc 09's `--column-N-color` palette contract** — the
  lane colour vars should be part of the same dictionary so themes
  can retint the graph lanes too.

## Source locations

- `/tmp/gk-asar/src/render/static/entryPoints/main/render.bundle.js`
- Symbols: `setTheme`, `_setTheme`, `setThemeSaga`, `setCurrentTheme`,
  `defineTheme`, `getTheme`, `getThemeDict`, `getCurrentCompiledTheme`,
  `getCurrentCompiledThemeString`, `currentCompiledTheme`,
  `currentCompiledThemeString`, `_themeStyleElement`, `useTheme`,
  `ThemeContext`, `ThemeProvider`, `_themeService`, `ThemeService`,
  `appThemes`, `getAppThemes`, `isBuiltInTheme`, `darkTheme`,
  `lightTheme`, `defaultTheme`, `themeOptions`,
  `getAvailableThemeOptions`, `getSwitchThemeItems`,
  `getSwitchThemeItemsForFilter`, `sortThemeOptions`, `SwitchTheme`,
  `SwitchThemePlaceholder`, `getCurrentProfileUiTheme`, `getOSTheme`,
  `osTheme`, `currentThemeScheme`, `themeSchemeTypes`, `isLightTheme`,
  `isCurrentThemeSchemeLight`, `getCurrentThemeScheme`,
  `getHighContrastColorForTheme`, `themeOpacityFactor`,
  `getThemeOpacityFactor`, `ckgroundColorFromColorAndTheme`,
  `regroundColorFromColorAndTheme`, `cssVariables`,
  `cssVariablesWithDefaults`, `getCssVariables`, `applyMonacoTheme`,
  `getMonacoEditorTheme`, `monacoEditorTheme`, `iconTheme`,
  `buildCustomThemeDeprecationNotice`, `CustomThemeDeprecationNotice`,
  `showCustomThemeDeprecationToastSaga`,
  `getCurrentThemeSchemeForAnalytics`.
- CSS custom-property names observed in the bundle string table:
  `--color-graph-scroll-marker-local-branches`,
  `--color-graph-scroll-marker-remote-branches`,
  `--color-graph-scroll-marker-pull-requests`,
  `--color-graph-scroll-marker-upstream`,
  `--color-graph-scroll-marker-selection`,
  `--color-graph-scroll-marker-stashes`,
  `--color-graph-scroll-marker-tags`,
  `--color-graph-scroll-marker-highlights`.
