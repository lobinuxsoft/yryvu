<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Everforest Dark (`i-everforest-dark`)

> Botanical organic warmth ("cabin in autumn") — soft radial canopy gradients and slow ambient breathing.

**Scheme:** dark

## What it is

Radial-gradient overlays on toolbar/tabs/cold-start; a slow title breathe.

## File layout

- `theme.toml`
- `tokens.css`
- `personality.css`

`README.md` (this file) is metadata for humans — the theme system never loads it.

## Animations

Yes — honors `prefers-reduced-motion: reduce`.

## Fork this theme

- In-app: **Preferences → UI → Duplicate "Everforest Dark" as new theme**, then edit the
  copy under `<app-config>/themes/<new-id>/`.
- By hand: copy this folder to `<app-config>/themes/<my-id>/`, rename the `id`
  in `theme.toml` to match the folder, and edit any file. Yryvu's file-watcher
  hot-reloads the active theme on save.

See the [token cheatsheet](../../../../../docs/themes/CHEATSHEET.md) for every
overridable `--*` and the [recipes](../../../../../docs/themes/EXAMPLES.md).
