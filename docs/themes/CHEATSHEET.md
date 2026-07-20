<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Theme token cheatsheet

Every overridable CSS custom property in Yryvu, grouped by category. A theme
sets these inside its `tokens.css` (`:root[data-theme="<id>"] { … }`); the
chrome reads them so a single override re-styles every surface that consumes
it. Defaults below are the chrome baseline in
[`apps/yryvu-app/src/styles/tokens.css`](../../apps/yryvu-app/src/styles/tokens.css)
— a theme that omits a token inherits that value.

Custom properties resolve **lazily at the use site**: e.g. `--btn-radius`
defaults to `var(--radius-md)`, so redefining `--radius-md` in a theme also
moves the button radius for free.

## Colors

| Token | Default | Consumed by |
|---|---|---|
| `--bg-0` … `--bg-4` | `#050708` → `#232a52` | Panel elevation layers (deepest → accent surface) |
| `--fg-0` … `--fg-3` | `#caedf2` → `#4b5c94` | Text ladder (primary → muted) |
| `--accent` / `--accent-hover` / `--accent-fg` | `#5b64b8` / `#7286c3` / `#f5f8ff` | Buttons, active states, focus, text-on-accent |
| `--success` / `--warning` / `--danger` / `--info` | `#6ab5a0` / `#c4a872` / `#c66594` / `#7f9dd8` | Status badges, diff tones, toasts |
| `--lane-0` … `--lane-9` | 10-colour palette | Commit-graph lane colours (`laneColor()` in [`RowRenderer/geometry.ts`](../../apps/yryvu-app/src/components/CommitGraph/RowRenderer/geometry.ts)) |
| `--border` | `var(--bg-3)` | Divider/outline shim (derives from colours) |
| `--selected-row` | `color-mix(--accent 18%)` | Selection highlight tint |

## Typography

| Token | Default | Consumed by |
|---|---|---|
| `--font-ui` | system sans stack | Base UI font |
| `--font-mono` | `FiraCode Nerd Font Mono`, … | Base mono stack |
| `--font-sans` | `var(--font-ui)` | Rendered markdown prose |
| `--font-toolbar` | `var(--font-ui)` | Toolbar (`.toolbar`) |
| `--font-sidebar` | `var(--font-ui)` | Sidebar (`.sidebar`) |
| `--font-graph-message` | `var(--font-ui)` | Commit-message column |
| `--font-code` | `var(--font-mono)` | Diff / code text |
| `--font-size-toolbar` | `13px` | Toolbar root |
| `--font-size-row` | `12px` | Graph rows |
| `--font-size-sidebar` | `12px` | Sidebar rows |
| `--font-size-statusbar` | `11px` | Status bar |

## Shapes

| Token | Default | Consumed by |
|---|---|---|
| `--radius-sm` / `--radius-md` / `--radius-lg` | `3px` / `4px` / `6px` | Geometry scale (other radii derive from these) |
| `--btn-radius` | `var(--radius-md)` | Buttons (toolbar, split, diff, prefs, hidden-refs) |
| `--btn-clip-path` | `none` | Button corner clipping (e.g. cut corners) |
| `--pill-radius` | `999px` | Ref pills, upstream pill, count badges, status pills |
| `--pill-clip-path` | `none` | Pill corner clipping |
| `--avatar-radius` | `50%` | Author avatars |
| `--avatar-clip-path` | `none` | Avatar clipping |

## Spacing

| Token | Default | Consumed by |
|---|---|---|
| `--gap-xs` / `--gap-sm` / `--gap-md` / `--gap-lg` | `4` / `8` / `12` / `16px` | Flex/grid gaps (`--gap-md` = toolbar gap) |
| `--padding-toolbar-x` / `-y` | `12px` / `0px` | Toolbar container padding |
| `--padding-row-x` / `-y` | `10px` / `4px` | Sidebar branch-row padding |
| `--padding-sidebar-x` / `-y` | `10px` / `6px` | Sidebar section-header padding |

## Borders

| Token | Default | Consumed by |
|---|---|---|
| `--border-width` | `1px` | Toolbar / sidebar dividers |
| `--border-style` | `solid` | Toolbar / sidebar dividers |

## Layout

| Token | Default | Consumed by |
|---|---|---|
| `--panel-width-left` / `-right` / `-left-collapsed` | `240` / `340` / `44px` | Side panel widths |
| `--toolbar-height` / `--tabs-height` / `--statusbar-height` | `56` / `36` / `28px` | Chrome band heights |
| `--graph-col-message` / `-author` / `-date-time` / `-sha` | `300` / `130` / `130` / `130px` | Graph column widths (overridden at runtime by the column resizer) |

## Graph visuals (#301)

| Token | Default | Consumed by |
|---|---|---|
| `--graph-node-radius` | `11px` | Commit-node radius (hydrated into the JS render dims) |
| `--graph-edge-width` | `2px` | Edge stroke width |

Both are re-read from CSS on graph mount and after each theme switch. Geometry
(row height, lane width, gutter, arc radius) stays JS-computed and is **not**
themeable — it would reflow the virtualizer.

## Icons (#300)

Each chrome icon is `--icon-<name>: url("data:image/svg+xml;base64,…")`,
painted through a CSS mask (`.icon[data-icon="<name>"]` in
[`icons.css`](../../apps/yryvu-app/src/styles/icons.css)). Override a single
icon with a new data-URI **or** by dropping `icons/<name>.svg` in the theme
folder (the backend inlines it — see [EXAMPLES](./EXAMPLES.md#override-an-icon)).

Available icon names:

```
arrow-down  arrow-up   branch     check       chevron-down  circle-dot
cloud       gear       info       open-folder plus          pull-request
redo        refresh    search     stash-in    stash-out     tag
tag-annotated  terminal  undo      users
```

## Where the defaults live

- Chrome baseline: [`apps/yryvu-app/src/styles/tokens.css`](../../apps/yryvu-app/src/styles/tokens.css)
- Icon mask rules: [`apps/yryvu-app/src/styles/icons.css`](../../apps/yryvu-app/src/styles/icons.css)
- Per-theme overrides: `crates/yryvu-bridge/resources/themes/<id>/tokens.css`
- Decorative rules: `<id>/personality.css` (or `<id>/personality/*.css` when layered)
