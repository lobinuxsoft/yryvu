<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Kanagawa (`j-kanagawa`)

> Sumi-e "great wave" — paper-grain surfaces, soft ink drop-shadows, and a misty toolbar wash.

**Scheme:** dark

## What it is

`<feTurbulence>` paper grain on sidebar + cold-start; dark ink drop-shadows.

## File layout

- `theme.toml`
- `tokens.css`
- `personality.css`

`README.md` (this file) is metadata for humans — the theme system never loads it.

## Animations

Yes — honors `prefers-reduced-motion: reduce`.

## Fork this theme

- In-app: **Preferences → UI → Duplicate "Kanagawa" as new theme**, then edit the
  copy under `<app-config>/themes/<new-id>/`.
- By hand: copy this folder to `<app-config>/themes/<my-id>/`, rename the `id`
  in `theme.toml` to match the folder, and edit any file. Yryvu's file-watcher
  hot-reloads the active theme on save.

See the [token cheatsheet](../../../../../docs/themes/CHEATSHEET.md) for every
overridable `--*` and the [recipes](../../../../../docs/themes/EXAMPLES.md).
