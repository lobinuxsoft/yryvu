<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Catppuccin Mocha (`c-catppuccin-mocha`)

> Pastel and cozy ("hygge") — mauve glows, warm gradient washes, and generously rounded shapes.

**Scheme:** dark

## What it is

Overrides `--btn-radius: 8px` and `--pill-radius: 999px` for a softer chrome.

## File layout

- `theme.toml`
- `tokens.css`
- `personality.css`

`README.md` (this file) is metadata for humans — the theme system never loads it.

## Animations

None — static decorative rules only.

## Fork this theme

- In-app: **Preferences → UI → Duplicate "Catppuccin Mocha" as new theme**, then edit the
  copy under `<app-config>/themes/<new-id>/`.
- By hand: copy this folder to `<app-config>/themes/<my-id>/`, rename the `id`
  in `theme.toml` to match the folder, and edit any file. Yryvu's file-watcher
  hot-reloads the active theme on save.

See the [token cheatsheet](../../../../../docs/themes/CHEATSHEET.md) for every
overridable `--*` and the [recipes](../../../../../docs/themes/EXAMPLES.md).
