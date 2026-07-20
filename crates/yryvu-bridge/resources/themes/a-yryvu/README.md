<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Yryvu (Default) (`a-yryvu`)

> Yryvu's flagship — deep matte black rising to violet-tinged elevation, a pale-cyan text ladder, and wine-warm status colours.

**Scheme:** dark

## What it is

The signature palette. Sets the reference every other built-in varies from.

## File layout

- `theme.toml`
- `tokens.css`
- `personality.css`

`README.md` (this file) is metadata for humans — the theme system never loads it.

## Animations

Yes — honors `prefers-reduced-motion: reduce`.

## Fork this theme

- In-app: **Preferences → UI → Duplicate "Yryvu (Default)" as new theme**, then edit the
  copy under `<app-config>/themes/<new-id>/`.
- By hand: copy this folder to `<app-config>/themes/<my-id>/`, rename the `id`
  in `theme.toml` to match the folder, and edit any file. Yryvu's file-watcher
  hot-reloads the active theme on save.

See the [token cheatsheet](../../../../../docs/themes/CHEATSHEET.md) for every
overridable `--*` and the [recipes](../../../../../docs/themes/EXAMPLES.md).
