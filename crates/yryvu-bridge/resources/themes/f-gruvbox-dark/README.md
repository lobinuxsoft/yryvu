<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Gruvbox Dark (`f-gruvbox-dark`)

> Brutalist retro terminal — hard square corners, heavy borders, embossed insets, and zero animation.

**Scheme:** dark

## What it is

Overrides `--btn-radius`/`--pill-radius`/`--avatar-radius` to ~1-2px for square chrome.

## File layout

- `theme.toml`
- `tokens.css`
- `personality.css`

`README.md` (this file) is metadata for humans — the theme system never loads it.

## Animations

None — static decorative rules only.

## Fork this theme

- In-app: **Preferences → UI → Duplicate "Gruvbox Dark" as new theme**, then edit the
  copy under `<app-config>/themes/<new-id>/`.
- By hand: copy this folder to `<app-config>/themes/<my-id>/`, rename the `id`
  in `theme.toml` to match the folder, and edit any file. Yryvu's file-watcher
  hot-reloads the active theme on save.

See the [token cheatsheet](../../../../../docs/themes/CHEATSHEET.md) for every
overridable `--*` and the [recipes](../../../../../docs/themes/EXAMPLES.md).
