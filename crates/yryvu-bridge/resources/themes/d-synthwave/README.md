<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Synthwave (`d-synthwave`)

> Cyberpunk neon — pulsing underglows on every chrome boundary, an RGB-shift glitch on ref pills, and a bolder graph.

**Scheme:** dark

## What it is

Overrides `--graph-node-radius`/`--graph-edge-width` and ships `icons/{undo,gear}.svg` overrides. Personality is split across `personality/*.css` (layered).

## File layout

- `theme.toml`
- `tokens.css`
- `personality/ (01-toolbar.css, 02-tabs.css, 03-sidebar.css, 04-pills.css, 05-status-bar.css, 06-cold-start.css, 07-reduced-motion.css)`
- `icons/ (gear.svg, undo.svg)`

`[layers]` in `theme.toml` loads `personality/*.css` in alphabetical order.
`icons/*.svg` override individual `--icon-*` (backend base64-inlines them).

`README.md` (this file) is metadata for humans — the theme system never loads it.

## Animations

Yes — honors `prefers-reduced-motion: reduce`.

## Fork this theme

- In-app: **Preferences → UI → Duplicate "Synthwave" as new theme**, then edit the
  copy under `<app-config>/themes/<new-id>/`.
- By hand: copy this folder to `<app-config>/themes/<my-id>/`, rename the `id`
  in `theme.toml` to match the folder, and edit any file. Yryvu's file-watcher
  hot-reloads the active theme on save.

See the [token cheatsheet](../../../../../docs/themes/CHEATSHEET.md) for every
overridable `--*` and the [recipes](../../../../../docs/themes/EXAMPLES.md).
