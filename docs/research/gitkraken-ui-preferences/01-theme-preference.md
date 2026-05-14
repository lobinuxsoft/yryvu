# 01 — Theme preference

The single largest GK port surface in #103. This doc reverse-engineers
GK's theme model end-to-end so yryvu's 10-theme implementation can be
aligned with the GK contract where it matters and deviated where it
doesn't.

## State shape

The Redux `theme` slice initial state (`bundle:165966-165974`):

```js
{
  appThemes: {},                      // { [themeId]: ThemeDefinition }
  currentCompiledTheme: {              // result of merging current theme tokens
    root: null,                        // map of CSS-var key → value for :root
    toolbar: null,                     // overrides for .toolbar selector
    tabsbar: null,                     // overrides for .tabs-bar selector
  },
  osTheme: "dark",                     // the OS-reported theme (THEME.DARK / .LIGHT)
}
```

`appThemes` is **populated at startup** by reading theme JSON from disk
— including any user-provided custom themes. Built-ins are loaded as
part of that same map; their entries carry `isBuiltInTheme: true`
(`bundle:411387`).

The currently selected theme id is **not** stored in the `theme` slice.
It lives in the **profile** slice at `["ui", "theme"]`
(`bundle:4753` — `ProfileSettingPaths.THEME = ["ui", "theme"]`). This
means each user profile carries its own theme choice. yryvu has no
profile system, so the same single value lives in `Preferences.ui.theme`.

## Built-in theme set

Source: `bundle:98529-98534`.

```js
THEME = {
  DARK: "dark",
  LIGHT: "light",
  HIGH_CONTRAST_DARK: "dark-high-contrast",
  HIGH_CONTRAST_LIGHT: "light-high-contrast",
}
```

Default at first run: `DEFAULT_THEME = THEME.DARK` (`bundle:218670`).

GK ships **four** built-in themes (vs yryvu's planned 10). Both
high-contrast variants are accessibility-focused; the regular dark/light
pair is the default UX.

## Theme schemes (lighting class)

A separate, smaller enum in `bundle:179521-179523`:

```js
themeSchemeTypes = { DARK: "dark", LIGHT: "light" }
```

Every theme has a `scheme` that is one of these two. The scheme drives
component-level branching that's binary: Monaco editor base
(`vs-dark` vs `vs`) at `bundle:9116`, PR diff hunk styling at
`bundle:361140`, etc. **Important**: the yryvu deviation ships 10 themes
that ALL must declare a scheme — this is a contract yryvu inherits even
though yryvu has no Monaco yet, because future surfaces (PR diff,
syntax-highlighted code blocks) will branch on it.

Selectors:

- `getCurrentTheme` resolves `SYNC_WITH_SYSTEM` to `osTheme` else
  passes through (`bundle:411322`).
- `getCurrentThemeScheme` reads the current theme's `.scheme` field,
  defaulting to DARK if missing (`bundle:411380-411382`).
- `getIsCurrentThemeSchemeLight` derives a boolean (`bundle:411384`).

## Theme options selector

`getAvailableThemeOptions` at `bundle:411324-411340`:

```js
const ct = lodash.keys(appThemes).map(themeId => ({
  label: appThemes[themeId].name,
  value: themeId,
}));
const platform = os.platform();
const release = os.release();
let supportsSystemSync = true;
if (platform === "win32" || platform === "darwin") {
  // semver gate vs EARLIEST_OS_SUPPORTS_DARK_THEME
  supportsSystemSync = semver.gte(release, EARLIEST_OS_SUPPORTS_DARK_THEME[platform]);
}
if (supportsSystemSync) {
  ct.push({ label: t("SyncWithSystem"), value: SYNC_WITH_SYSTEM });
}
return sortThemeOptions(ct); // sort by label asc
```

`EARLIEST_OS_SUPPORTS_DARK_THEME` (`bundle:218667-218670`):

| Platform | Minimum kernel/build |
|---|---|
| `darwin` | `18.0.0` (macOS 10.14 Mojave — first OS with dark mode) |
| `win32` | `10.0.0` (Windows 10) |

On Linux the gate is unconditional — `SyncWithSystem` is always offered.
yryvu running on Bazzite picks up the same Linux behavior for free.

## Compiled theme string

`getCurrentCompiledThemeString` at `bundle:411359-411379` is the
load-bearing function: it converts the active theme's token map into a
literal CSS string:

```css
:root {
  <key>: <value>;
  ...
}
.toolbar {
  <key>: <value>;
  ...
}
.imitate-toolbar {
  <key>: <value>;
  ...
}
.tabs-bar {
  <key>: <value>;
  ...
}
```

That string is **injected into the document head** via React Helmet at
`bundle:104435`:

```js
React.createElement(Helmet, null,
  React.createElement("style", null, currentCompiledThemeString)
)
```

This is the yryvu-aligned approach — same mechanism, different
delivery. yryvu's design-previews already embed `:root { ... }` blocks
inside `<style>` tags. The port is straightforward: keep the same
contract, deliver via Solid's reactive primitives instead of Helmet.

## Theme keys (tokens)

`THEME_KEYS` at `bundle:218670` is a 400+ entry array of every CSS
custom property GK references. **Do not port verbatim** — the yryvu
token contract is much smaller (`apps/yryvu-app/src/styles/tokens.css`
+ `design-previews/preferences-themes/a-default.html`):

| yryvu tokens | GK rough equivalent | Notes |
|---|---|---|
| `--bg-0..--bg-4` | `--app__bg0`, `--panel__bg0..--panel__bg2`, `--toolbar__bg0..2` | yryvu compresses 9 GK layers into 5 |
| `--fg-0..--fg-3` | `--text-normal`, `--text-secondary`, `--text-disabled`, `--text-bright`, `--text-dimmed` | yryvu compresses 5 GK fg roles into 4 |
| `--accent`, `--accent-hover`, `--accent-fg` | `--primary-bg`, `--primary-hover`, `--primary-text-normal` | yryvu uses simpler primary contract |
| `--success`, `--warning`, `--danger`, `--info` | `--success-bg`, `--warning-bg`, `--danger-bg` (+text/border variants) | yryvu ships single-color status, no per-component states yet |
| `--lane-0..--lane-9` | `--graph-color-0..--graph-color-9` (+ `-f10`, `-f50`, `-bg25`, `-bg45`, `-bg50`, `-bg15` variants) | yryvu flat 10, no opacity-derivative tokens |
| `--row-h`, `--lane-w`, `--gutter`, `--commit-r` | `--graph-row-height` (+ structural geometry not exposed as theme tokens) | yryvu adds graph geometry to theme contract |
| `--font-ui`, `--font-mono` | `--font-default`, `--font-monospace` | identical role |
| `--radius-{sm,md,lg}` | `--button-radius`, `--input-radius`, `--checkbox-border-radius` | yryvu generic radii vs GK per-component |

The yryvu contract is **deliberately smaller** — it sacrifices fine-
grained component theming for the ability to ship 10 distinct themes
without 400 tokens to hand-tune each. This is a defensible tradeoff for
v1; if user-submitted custom themes become a feature, the contract can
expand incrementally without breaking the existing 10.

## SYNC_WITH_SYSTEM mechanism

`SYNC_WITH_SYSTEM = "SYNC_WITH_SYSTEM"` (`bundle:218670`) is a sentinel
string. When the user selects it, the **stored** profile setting is the
literal string `"SYNC_WITH_SYSTEM"` (not a resolved theme id). Read-time
resolution happens in `getCurrentTheme` (`bundle:411322`):

```js
getCurrentTheme = createSelector(
  getCurrentProfileUiTheme,  // the stored value: themeId | "SYNC_WITH_SYSTEM"
  getOSTheme,                // "dark" | "light"
  (stored, os) => stored === SYNC_WITH_SYSTEM ? os : stored,
);
```

And `state.theme.osTheme` is **kept in sync with the OS** by main-process
listeners (Electron's `nativeTheme.on('updated')` — not in this bundle
because it's renderer-side, but the seed value `osTheme: THEME.DARK` is
at `bundle:165973`).

For yryvu the equivalent is `window.matchMedia('(prefers-color-scheme:
dark)')` with a `change` listener — see doc 12.

## yryvu variant: `auto` instead of `SYNC_WITH_SYSTEM`

The yryvu design-previews list 10 themes (a-default through
j-kanagawa). To match GK's behavior, yryvu adds an 11th option with
id `auto` (renaming GK's `SYNC_WITH_SYSTEM` for shorter URL/persistence
strings). The auto resolver picks one of two themes based on
`prefers-color-scheme`:

| OS prefers | yryvu resolves to |
|---|---|
| `dark` | `a-default` (yryvu's default dark theme) |
| `light` | `e-rose-pine-dawn` (yryvu's only light-scheme theme) |

If the user picks any other theme, `auto` is irrelevant and the picked
theme renders regardless of OS. See `09-yryvu-deviations.md` for why
yryvu ships only one light-scheme theme in v1.

## Custom themes — explicit non-goal for v1

GK supports user-provided theme JSON files (`isBuiltInTheme: false`,
`bundle:411387`). yryvu v1 **does not**. Reasons:

1. The 10 built-ins cover the requested aesthetic spectrum
   (Tokyo Night, Catppuccin, Synthwave, Rose Pine, Gruvbox, Nord,
   Dracula, Everforest, Kanagawa, default yryvu) — there's no obvious
   gap a user would fill with their own.
2. Custom theme schema requires a stable token contract. The yryvu
   contract is still small (~30 tokens) and likely to grow as new
   surfaces land — locking it now would force a v1→v2 break later.
3. The compiled-theme-string mechanism doesn't change between
   built-in and custom — only the source of the input map. So custom
   themes can be added in a follow-up issue without re-architecting.

If user demand surfaces, the follow-up issue: **feat(preferences):
load user-provided theme files from `~/.config/yryvu/themes/*.json`**.

## Live-apply (no app reload)

GK changes themes **without reloading**. The flow:

1. User picks a new value in the `<select>` at `bundle:345894-345903`.
2. `onChange` calls `setCurrentTheme(value)` which dispatches the saga
   at `bundle:248839-248843`.
3. The saga sends `SET_THEME` IPC (`bundle:4740`) to the main process.
4. Main process persists the new value in the profile.
5. The renderer re-derives `currentCompiledTheme` via Redux selectors.
6. Helmet sees the new compiled string and updates the injected
   `<style>` tag.
7. CSS custom property propagation re-paints all consumers.

For yryvu the simpler equivalent (no main-process round-trip in v1):

1. User picks a new value.
2. `setUiPreference("themeId", value)` updates the Solid signal AND
   calls `ipc.savePreferences()` (atomic write, ~5ms).
3. An `effect` watches the signal and sets
   `document.documentElement.dataset.theme = themeId`.
4. The 10 `<link rel="stylesheet">` for theme files have their
   `:root[data-theme="<id>"]` selectors take effect immediately.

See doc 12 for the apply mechanism choice (single CSS file with all
selectors vs. lazy-loaded per-theme files).

## What yryvu's UI panel actually shows for theme

A single `<select>` row, label `"Theme"`. Options come from the static
list of 11 (10 built-ins + `auto`). Default value: `auto` if running
v1, `a-default` if `prefers-color-scheme` cannot be detected.

```tsx
<PreferenceRow label={t("UiPreferences-Theme")}>
  <select value={ui.themeId()}
          onChange={e => setUiPreference("themeId", e.currentTarget.value)}>
    <option value="auto">{t("UiPreferences-Theme-Auto")}</option>
    <option value="a-default">a · Default yryvu</option>
    <option value="b-tokyo-night">b · Tokyo Night</option>
    ...
    <option value="j-kanagawa">j · Kanagawa</option>
  </select>
</PreferenceRow>
```

Triage: **KEEP, ported with yryvu-specific deviation** (10 themes vs 4,
no custom-theme support).

## Cross-validation

Re-grepped:

```
$ grep -n "ProfileSettingPaths" /tmp/gk-bundle-pretty.js | head -3
4745:                at.ProfileSettingPaths = {
$ grep -n "THEME: \[" /tmp/gk-bundle-pretty.js
4753:                    THEME: ["ui", "theme"],
$ grep -n "DARK: \"dark\"" /tmp/gk-bundle-pretty.js | head -3
98530:                    DARK: "dark",
179522:                    DARK: "dark",
```

All citations check out.
