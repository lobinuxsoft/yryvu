# 05 — Zoom (text size / window scale)

## Bundle reality: GK has zoom, but in a different surface

GK's zoom **does** exist as a preference, but the surface is the
status bar — not the Preferences window.

### Where it renders

The status bar render code at `bundle:186319-186322` constructs a
zoom `<select>`:

```js
const xa = lodash.map(value => React.createElement("option", {
  key: `zoom-${value}`,
  value: value,
}, `${Math.round(100 * value)}%`), An.ZOOM_FACTORS);
```

`ZOOM_FACTORS` is the discrete ladder of allowed values
(`bundle:256353`):

```js
ZOOM_FACTORS = [1.3, 1.2, 1.1, An, 0.9, 0.8]
//                            ^ DEFAULT_ZOOM_FACTOR = 1
```

So the user picks from **130%, 120%, 110%, 100%, 90%, 80%**. Default
100%. The values render in that order top-to-bottom in the dropdown.

### Issue #103 had the wrong ladder

The issue body proposed `75/100/125/150`. The actual GK ladder is
`80/90/100/110/120/130`. Two important deltas:

1. GK's max is 130%, not 150%. (A 150% factor on a 1080p panel pushes
   the toolbar height to 84px and breaks the layout.)
2. GK's steps are 10% increments centered on 100%, not 25% increments.
   (10% feels smoother and gives users a finer dial.)

**Recommendation**: chajá ports the GK ladder verbatim.

### Persistence path

`["zoom"]` — top-level on the profile, NOT under `ui` (`bundle:4754`
`ProfileSettingPaths.ZOOM = ["zoom"]`). Selector at `bundle:10626-10629`:

```js
const getZoomFactor = state => getCurrentProfileSetting(state, {
  path: ["zoom"],
});
```

For chajá, the equivalent path is also flat — but inside `UiPreferences`
since chajá has no separate profile envelope:

```rust
pub struct UiPreferences {
    pub zoom: f32, // default 1.0, allowed values 0.8/0.9/1.0/1.1/1.2/1.3
    ...
}
```

f32, not enum, because GK stores it as a number and the validation lives
in the UI layer (the `<select>` constrains to the allowed set; future
upper bound widening is a one-line bundle change).

### Apply mechanism

GK applies zoom via Electron's `webFrame.setZoomFactor` at
`bundle:231650`:

```js
yield call([webFrame, webFrame.setZoomFactor], value);
```

This is Electron-specific. Tauri's webview doesn't expose the same API
directly. **chajá zoom must use a different mechanism**:

#### Option A — root font-size

Set `font-size` on `<html>` to `13px * zoom`:

```css
:root { font-size: 13px; }
:root[data-zoom="1.1"] { font-size: 14.3px; }
```

Pros: simple, doesn't break layout, preserves devicePixelRatio.
Cons: every dimension must be in `rem` not `px` for it to scale.
Half of chajá's CSS uses `px` today — this is a refactor cost.

#### Option B — CSS `zoom` property

```css
:root[data-zoom="1.1"] { zoom: 1.1; }
```

Pros: works on every CSS property, no refactor needed.
Cons: non-standard (Webkit-derived, not in CSSWG specs), can break
fixed/sticky positioning, blurry text on some Linux configurations.

#### Option C — CSS `transform: scale()`

Pros: standard.
Cons: doesn't reflow content; the unscaled element still occupies the
original layout box, leading to scrollbars or clipping.

#### Option D — Tauri webview zoom

Tauri 2.x exposes `WebviewWindow.setZoom(factor)` on some platforms.
Coverage as of Tauri 2.1: macOS yes, Windows yes (WebView2), Linux
**partially** (depends on WebKitGTK version). Bazzite ships WebKitGTK
2.42+ which supports it; older distros may not. Not recommended for
chajá v1 because of platform inconsistency and because the Tauri
maintainers warn it's brittle.

### Recommendation: Option A (root font-size)

Long-term correct: every dimension is in `rem`. Short-term cost: a
codemod to convert `px` to `rem` in the existing stylesheets. Estimate
~50–80 sites; mostly mechanical (the design-previews already use a
mix of `px` and `rem`).

Alternative phased rollout:

1. v1 ship Option B (CSS `zoom`) — no refactor, immediate.
2. v2 migrate to Option A as part of a `rem` codemod.

Choosing Option B for v1 is acceptable if the implementation PR
includes a follow-up issue: **chore(styles): migrate px to rem for
zoom-correct scaling**.

### What chajá's UI panel shows

```tsx
<PreferenceRow label={t("UiPreferences-Zoom")}>
  <select value={ui.zoom()}
          onChange={e => setUiPreference("zoom", parseFloat(e.currentTarget.value))}>
    <option value="0.8">80%</option>
    <option value="0.9">90%</option>
    <option value="1.0">100%</option>
    <option value="1.1">110%</option>
    <option value="1.2">120%</option>
    <option value="1.3">130%</option>
  </select>
</PreferenceRow>
```

Issue #103 places zoom in the Preferences window. **GK puts it in the
status bar.** Choice for chajá:

| Place | Pros | Cons |
|---|---|---|
| Preferences window only | Fits the chajá #103 acceptance criteria as written; simpler | One extra click to change zoom; loses muscle-memory parity for users coming from GK |
| Status bar only | GK parity; zero-click change | Adds clutter to the status bar; not mentioned in #103 |
| Both surfaces | Best of both; same Solid signal underlies both controls | One more surface to maintain |

**Recommendation**: ship in Preferences window for v1 (matches #103
acceptance), then file follow-up issue for status-bar shortcut once
the Preferences UI lands.

### Persistence + live-apply

`Preferences.ui.zoom: f32` persisted in `preferences.json`. Live-apply
via the chosen mechanism (A or B).

If Option A: the `effect` updates `document.documentElement.style.fontSize`.
If Option B: the `effect` updates `document.documentElement.dataset.zoom`.

### Startup zoom

GK applies the saved zoom on app start at `bundle:231647-231651`
(`setStartupZoom`). chajá's equivalent: when `<App>` mounts and the
preferences load completes, the same `effect` fires once and applies
the saved value before first paint.

### Cross-validation

Re-grepped:

```
$ grep -n "ZOOM_FACTORS = \[" /tmp/gk-bundle-pretty.js
256353:                    Dn = (at.ZOOM_FACTORS = [1.3, 1.2, 1.1, An, .9, .8], at.DARWIN_WINDOW_BUTTON_POSITIONS_BY_ZOOM_FACTOR = {
$ grep -n "DEFAULT_ZOOM_FACTOR = 1" /tmp/gk-bundle-pretty.js
256352:                    An = (at.GITKRAKEN_HELP_HOME_URL = `${Rn}/gitkraken-desktop-home`, at.GITKRAKEN_HELP_GK_AI_URL = `${Rn}/gkd-gitkraken-ai`, at.PROACTIVE_CONFLICT_DETECTION_HELP_URL = `${Rn}/conflict-prevention`, at.GITKRAKEN_PRICING_URL = "https://gitkraken.com/pricing?source=gitkraken", at.ORGANIZATION_PREFERENCES_DEEP_LINK = "gitkraken://preferences/organization", at.DEFAULT_ZOOM_FACTOR = 1),
$ grep -n "webFrame.setZoomFactor" /tmp/gk-bundle-pretty.js
231650:                        Ve && (yield(0, dn.call)([ln.webFrame, ln.webFrame.setZoomFactor], Ve))
```

All citations confirmed.

## Triage

**KEEP**, port with chajá-specific apply mechanism (no Electron
`webFrame`). Use the GK ladder verbatim (80–130%, 10% steps, default
100%). Place in Preferences window for v1.
