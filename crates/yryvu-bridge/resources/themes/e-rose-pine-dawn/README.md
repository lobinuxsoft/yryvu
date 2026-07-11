<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Rosé Pine Dawn (`e-rose-pine-dawn`)

> A **light** "morning newspaper" — paper-grain texture, a serif italic title, and soft sumi-ink shadows (no neon).

**Scheme:** light

## What it is

Uses a `<feTurbulence>` data-URI for paper grain and a serif `--font` on the title.

## File layout

- `theme.toml`
- `tokens.css`
- `personality.css`

`README.md` (this file) is metadata for humans — the theme system never loads it.

## Animations

None — static decorative rules only.

## Fork this theme

- In-app: **Preferences → UI → Duplicate "Rosé Pine Dawn" as new theme**, then edit the
  copy under `<app-config>/themes/<new-id>/`.
- By hand: copy this folder to `<app-config>/themes/<my-id>/`, rename the `id`
  in `theme.toml` to match the folder, and edit any file. Yryvu's file-watcher
  hot-reloads the active theme on save.

See the [token cheatsheet](../../../../../docs/themes/CHEATSHEET.md) for every
overridable `--*` and the [recipes](../../../../../docs/themes/EXAMPLES.md).
