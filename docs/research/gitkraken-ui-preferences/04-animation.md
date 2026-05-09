# 04 — Animation toggle

## Bundle reality: GK has no animation preference

I searched for `animationsEnabled`, `disableAnimation`, `reducedMotion`,
`animationDuration` as preferences — **zero hits**.

The bundle does have:

- A `transitionEnd` / `animationEnd` polyfill module at `bundle:257310`.
  It's a CSS-prefix utility, not a user setting.
- Toast enter/exit animations hardcoded at `bundle:104429-104430`:
  `enter-animation-right 0.5s forwards ease`. Hardcoded duration,
  hardcoded easing.
- `expand-detail-panel-transition` is a theme token (`bundle:218670`),
  meaning the duration of one specific panel-resize animation is
  themeable. But there's no user toggle that disables it.

GK doesn't ship a global animation toggle. Like tooltips, it's an
opinionated design choice: GK considers animations integral to the
spatial-continuity UX of the graph and panels.

Triage: **yryvu-only addition (FLAG)**. Same justification as
tooltips: accessibility (motion sickness, vestibular disorders) +
power-user preference (some folks find animation slow). The bar for
shipping this is **lower** than tooltips because the OS-level
`prefers-reduced-motion` media query already provides a no-cost honor
path that even GK doesn't fully use.

## yryvu design

A tri-state, not boolean:

```rust
#[serde(rename_all = "camelCase")]
pub enum AnimationMode {
    /// Honor the OS `prefers-reduced-motion` setting — animations on
    /// by default but disabled when the OS requests reduced motion.
    /// Recommended default.
    System,
    /// Animations always on.
    Always,
    /// Animations always off.
    Never,
}
```

The default is `System` — this is the only setting in the panel that
defaults to "follow OS" because the OS hint exists, is widely respected
in modern UI, and has zero implementation cost (a single CSS media
query).

## What yryvu's UI panel shows

```tsx
<PreferenceRow label={t("UiPreferences-Animations")}>
  <select value={ui.animations()}
          onChange={e => setUiPreference("animations", e.currentTarget.value)}>
    <option value="system">{t("UiPreferences-Animations-System")}</option>
    <option value="always">{t("UiPreferences-Animations-Always")}</option>
    <option value="never">{t("UiPreferences-Animations-Never")}</option>
  </select>
</PreferenceRow>
```

## Implementation surface

A single `data-animations` attribute on `<html>`:

```html
<html data-animations="never">  <!-- or "always" / "system" -->
```

The CSS gates animations:

```css
/* Default — always on */
.panel-slide { transition: transform 250ms ease; }

/* User explicitly off */
:root[data-animations="never"] *,
:root[data-animations="never"] *::before,
:root[data-animations="never"] *::after {
  animation: none !important;
  transition: none !important;
}

/* Honor OS — only when user picked System */
@media (prefers-reduced-motion: reduce) {
  :root[data-animations="system"] *,
  :root[data-animations="system"] *::before,
  :root[data-animations="system"] *::after {
    animation: none !important;
    transition: none !important;
  }
}
```

The `!important` is intentional — third-party libraries (if any) embed
inline transitions that we want to override unconditionally.

## What yryvu animates

Inventory of current/planned animations the toggle affects:

| Surface | Animation | Source |
|---|---|---|
| Toast enter/exit | 250ms slide+fade | `apps/yryvu-app/src/components/Toast/` |
| Panel collapse/expand | 200ms width transition | `apps/yryvu-app/src/components/SidePanel/` |
| Modal open/close | 150ms fade + 8px slide | (planned, not shipped yet) |
| Hover states (button bg) | 100ms color transition | global |
| Loading spinner | 1s rotation | `apps/yryvu-app/src/components/Spinner/` (the spinner's `animation` is exempt — the doc-1 selector targets `:root[data-animations="never"] *` but the spinner has a special-case `animation: spin 1s linear infinite !important` that survives the override; without animation the spinner is just a static icon, which is fine) |
| Graph commit-row hover-highlight | 80ms bg transition | `apps/yryvu-app/src/components/Graph/` (when shipped) |

The spinner exemption is worth calling out in the implementation PR —
the global `* { animation: none !important }` will kill the spinner
unless we override. Either special-case it or accept a static spinner
when motion is disabled (a11y-friendly choice, but the user will see
loading without indication of progress; design call).

**Recommendation**: special-case the spinner. Loading feedback is more
important than aesthetic motion reduction.

## Persistence path

`Preferences.ui.animations: "system" | "always" | "never"` —
default `system`.

## Live-apply

Same effect pattern as theme: signal change → effect updates
`document.documentElement.dataset.animations`.

## Triage

**FLAG (yryvu-only)**. Ship the tri-state. Default to `system`.
Justify in PR with a11y rationale + screenshot of the
`prefers-reduced-motion` honor path.
