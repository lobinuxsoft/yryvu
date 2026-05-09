# 03 — Tooltip behavior

## Bundle reality: GK has no tooltip preference

I searched the bundle for `tooltipBehavior`, `disableTooltip`,
`ShowTooltips`, `tooltipDelay`, `tooltipsEnabled` — **zero hits** for
any user-facing preference.

The closest GK has:

- A `disableTooltips` saga at `bundle:1727-1729`. It's a one-shot
  saga used by the tab-hover mechanism only — when a tab gets
  unhovered, after `TAB_TOOLTIP_RESET_MS` it dispatches
  `TabHoverTooltipsDisabled` to clear the per-tab "show tooltip"
  flag. **Not a global preference toggle**.
- An `enableTooltips` saga at `bundle:1723-1725`. Symmetric pair —
  fires on hover after `TAB_TOOLTIP_HOVER_MS` to enable the tab's
  tooltip. Also tab-bar specific.
- `<Tooltip>` components scattered through the codebase (e.g.
  `bundle:186413`, `bundle:186426`) — these use Bootstrap's
  `OverlayTrigger` with hardcoded delays per-instance.

The two delay constants (`TAB_TOOLTIP_HOVER_MS`,
`TAB_TOOLTIP_RESET_MS`) are not even hoisted to a settings module —
they're tab-cluster constants only.

GK's user has **no way to globally disable tooltips, change the delay,
or set tooltip behavior**. This is a GK design choice (the bundle
has hundreds of tooltips and they're all considered essential UX).

Triage: **yryvu-only addition (FLAG)**. Justification: accessibility
+ power-user preference. Many users find tooltip flicker on hover
distracting; many a11y tools recommend longer delays.

## yryvu design

A single boolean flag:

```rust
#[serde(rename_all = "camelCase")]
pub struct UiPreferences {
    /// Show tooltips on hover/focus. When false, tooltips are
    /// suppressed globally (icons still have aria-label for
    /// screen readers, but no visual popover renders).
    pub tooltips_enabled: bool, // default true
    /// Hover delay before tooltip shows, in milliseconds.
    /// Active only when tooltips_enabled. Range [0, 2000].
    pub tooltip_delay_ms: u16, // default 500
}
```

Two settings, not one. The reasoning: a pure on/off is too coarse
(some users want tooltips but slower); a delay-only setting is
confusing (delay = max-int means "off" via implicit). Two explicit
fields makes both axes obvious.

## What yryvu's UI panel shows

```tsx
<PreferenceRow label={t("UiPreferences-TooltipsEnabled")}>
  <input type="checkbox"
         checked={ui.tooltipsEnabled()}
         onChange={e => setUiPreference("tooltipsEnabled", e.currentTarget.checked)}/>
</PreferenceRow>
<PreferenceRow label={t("UiPreferences-TooltipDelayMs")}
               disabled={!ui.tooltipsEnabled()}>
  <input type="number"
         min={0} max={2000} step={50}
         value={ui.tooltipDelayMs()}
         onChange={e => setUiPreference("tooltipDelayMs", parseInt(e.currentTarget.value, 10))}/>
</PreferenceRow>
```

The second row is visually disabled when the first is unchecked.

## Implementation surface

A central `<Tooltip>` component in `apps/yryvu-app/src/components/Tooltip/`
(if not already present) reads both signals:

```tsx
function Tooltip(props: { children: JSX.Element; content: string }) {
  const enabled = () => preferences.ui.tooltipsEnabled();
  const delay = () => preferences.ui.tooltipDelayMs();
  // if !enabled(), render children without overlay infra at all
  if (!enabled()) return props.children;
  // else use Solid's createSignal + setTimeout(delay) on hover
  ...
}
```

Every existing `title="..."` attribute and every existing tooltip
component must funnel through this. New code is a refactor, not a
greenfield — the audit before opening the implementation PR should
grep for `title=` and `<Tooltip>` and report the count.

## Persistence path

`Preferences.ui.tooltipsEnabled: bool` and
`Preferences.ui.tooltipDelayMs: u16` — both persist in
`preferences.json` via the existing atomic-write infrastructure. Default
values applied via `#[serde(default)]` on the struct fields.

## Live-apply

Both settings are **read-on-render** by the `<Tooltip>` component.
No effect / no DOM-mutation needed. Changing the value re-renders
existing tooltip-wrapped elements via Solid's reactive primitives.

## Triage

**FLAG (yryvu-only)**. Ship the two-field setting. Justify in the
implementation PR description with the a11y + power-user rationale.
