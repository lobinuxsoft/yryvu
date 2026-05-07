# 02 — Density

## Bundle reality: GK has no density preference

`density` is **not** a GK UI preference. Searches in the bundle hit
unrelated code (a `RaceForm` UI dropdown for "personal pull request"
density at `bundle:78624`, and a Markdown-table density preset for
agents at `bundle:34930`). None of those are user-facing UI density.

The closest GK does have:

- **Compact graph column layout** (`bundle:303205`
  `UIPreferences-CompactGraphColumnLayout`). This is **not** a
  preference — it's a graph context-menu action that resets column
  widths to a compact layout. It's a one-shot "reset", not a sustained
  density mode.
- A `compact` constant in some commit-zone width arrays
  (`COMMIT_ZONE_COMPACT_WIDTH` etc., referenced at `bundle:356173`).
  These are dynamic widths that switch based on viewport width, not a
  user toggle.

There is no setting like `density: "compact" | "comfortable"` anywhere
in the GK preferences slice.

Triage: **chajá-only addition (FLAG)**. Defensible because every
modern dev tool (VSCode, IntelliJ, Slack, GitHub) ships density. The
chajá design-previews already reflect comfortable density — adding a
compact mode is a low-cost UX win.

## chajá design

A single global flag, two values:

```rust
#[serde(rename_all = "camelCase")]
pub enum Density {
    Comfortable,  // default — matches design-previews
    Compact,      // tighter row heights, smaller paddings
}
```

Applied via a single `data-density` attribute on `<html>`, mirroring
the theme mechanism:

```html
<html data-theme="a-default" data-density="compact">
```

CSS reads it:

```css
:root {
  --row-h: 28px;
  --gutter: 28px;
  --toolbar-height: 56px;
}
:root[data-density="compact"] {
  --row-h: 22px;
  --gutter: 22px;
  --toolbar-height: 44px;
}
```

This keeps the surface-area to a single attribute and a small CSS
override block per density. No per-zone density (left panel vs graph
vs right panel each having their own density) — that's overkill for v1
and not in any reference product.

## Why a single global flag, not per-zone

The original #103 prompt left "per-zone density (compact / rich / text)"
as a candidate. Reasons to reject:

1. **No reference**. GK doesn't have it. VSCode doesn't have it.
   IntelliJ has Compactness Mode (a single global flag), not per-zone.
2. **UX confusion**. "The graph is compact but the left panel is
   comfortable" is incoherent.
3. **CSS cost**. Per-zone needs scoped variables that override the
   global, multiplying the override blocks.

If a power user wants tighter graph rows specifically, that's
graph-cluster scope (#155 / graph zoom), not UI preferences.

## Affected tokens (chajá)

The compact mode reduces these tokens by roughly 75–80%:

| Token | Comfortable | Compact |
|---|---|---|
| `--row-h` (graph row height) | 28px | 22px |
| `--toolbar-height` | 56px | 44px |
| `--statusbar-height` | 28px | 22px |
| `--tabs-height` | 36px | 28px |
| `--gutter` (graph gutter) | 28px | 22px |
| `font-size` (root) | 13px | 12px |
| Form-row vertical padding | 8px | 6px |
| Modal padding | 24px | 16px |

Lane width (`--lane-w: 22px`) and commit radius (`--commit-r: 11px`)
are **not** scaled — they're geometric, not density-driven.

## Persistence path

`Preferences.ui.density: "comfortable" | "compact"` — string enum
persisted in the existing `preferences.json`. Default
`comfortable`. Live-apply: `effect` on the signal sets
`document.documentElement.dataset.density = value`.

## What chajá's UI panel shows

```tsx
<PreferenceRow label={t("UiPreferences-Density")}>
  <select value={ui.density()}
          onChange={e => setUiPreference("density", e.currentTarget.value)}>
    <option value="comfortable">{t("UiPreferences-Density-Comfortable")}</option>
    <option value="compact">{t("UiPreferences-Density-Compact")}</option>
  </select>
</PreferenceRow>
```

Triage: **FLAG (chajá-only)**. Ship a single global toggle. Defer
per-zone forever (or until concrete user demand).
