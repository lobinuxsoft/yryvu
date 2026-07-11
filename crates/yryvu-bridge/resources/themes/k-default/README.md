<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Default Dark (`k-default`)

> The neutral baseline — depth and clean edges, no glow or animation. The floor the other themes build above.

**Scheme:** dark

## What it is

Only soft elevation shadows + a clean active-tab underline. No tokens beyond the palette.

## File layout

- `theme.toml`
- `tokens.css`
- `personality.css`

`README.md` (this file) is metadata for humans — the theme system never loads it.

## Animations

None — static decorative rules only.

## Fork this theme

- In-app: **Preferences → UI → Duplicate "Default Dark" as new theme**, then edit the
  copy under `<app-config>/themes/<new-id>/`.
- By hand: copy this folder to `<app-config>/themes/<my-id>/`, rename the `id`
  in `theme.toml` to match the folder, and edit any file. Yryvu's file-watcher
  hot-reloads the active theme on save.

See the [token cheatsheet](../../../../../docs/themes/CHEATSHEET.md) for every
overridable `--*` and the [recipes](../../../../../docs/themes/EXAMPLES.md).
