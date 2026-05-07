# 09 — chajá deviations from GK

The chajá UI preferences panel is **not** a 1:1 GK port. This doc
makes every deviation explicit so the implementation PR isn't a
surprise to the auditor and so the rationale survives in the repo for
future contributors who ask "why is this different from GK?".

## Deviation 1: 10 built-in themes vs GK's 4

GK ships 4 built-in themes (`bundle:98529-98534`):
- dark
- light
- dark-high-contrast
- light-high-contrast

chajá ships 10 (per `design-previews/preferences-themes/`):
- a-default (chajá's signature dark)
- b-tokyo-night
- c-catppuccin-mocha
- d-synthwave
- e-rose-pine-dawn (the only light-scheme theme)
- f-gruvbox-dark
- g-nord
- h-dracula
- i-everforest-dark
- j-kanagawa

**Why deviate**: chajá's pitch is "open-source GitKraken-style client".
The 4-theme baseline is identity-poor and doesn't reflect the modern
dev-tool aesthetic spectrum (Tokyo Night, Catppuccin, Gruvbox are
ubiquitous in VSCode / Neovim ecosystems and signal "this app gets
it"). 10 themes is the maximum the design-previews session settled
on for a non-overwhelming dropdown. Decided 2026-04-29 in the
`design-previews/` work.

**Source-of-truth**: `design-previews/preferences-themes/<id>.html`
files. Each is self-contained — copy the `:root` block to chajá's
theme CSS file. NO JSON / TOML — the chajá themes are CSS-native, no
intermediate format.

**Cost vs benefit**: 10 themes = 10 small CSS files (~2KB each
post-minification = ~20KB total) + 10 entries in a `<select>`. Trivial.

## Deviation 2: No high-contrast variants

GK ships 2 high-contrast themes; chajá v1 ships 0.

**Why**: chajá's 10 themes already include several high-contrast-by-
design entries (Gruvbox Dark and Tokyo Night both have very high
luminance contrast). High-contrast as a separate axis (orthogonal to
dark/light) is a future-work concern.

**Future**: file follow-up issue **feat(themes): high-contrast theme
variants for accessibility** if user demand surfaces.

## Deviation 3: No custom themes

GK supports user-provided theme files (`isBuiltInTheme: false` flag,
`bundle:411387`). chajá v1 does not.

**Why**: see doc 01 — the chajá token contract is small and
unstable; locking it now would force a v1→v2 break. Add custom themes
once the contract has stabilized over 2-3 release cycles.

## Deviation 4: `auto` instead of `SYNC_WITH_SYSTEM`

GK uses the literal string `"SYNC_WITH_SYSTEM"` as the OS-follow
sentinel (`bundle:218670`). chajá uses the shorter `"auto"`.

**Why**: aesthetics + URL/persistence brevity. The string lives in
`preferences.json` and would need to be referenced in deep links
(future). `auto` is shorter, more conventional (CSS `color-scheme:
auto` uses it), and easier to type. Pure cosmetic deviation.

## Deviation 5: Density (chajá-only)

GK has no density preference. chajá ships a single global toggle
(`comfortable` | `compact`).

**Why**: see doc 02. Modern dev tool convention; small CSS cost.

## Deviation 6: Tooltip toggle + delay (chajá-only)

GK has no tooltip preference. chajá ships two settings
(`tooltipsEnabled: bool`, `tooltipDelayMs: u16`).

**Why**: see doc 03. a11y + power-user. Two settings (not one) because
"on/off" is too coarse and "delay-only" is implicit-mode-confusing.

## Deviation 7: Animation mode tri-state (chajá-only)

GK has no animation preference. chajá ships a tri-state
(`system` | `always` | `never`).

**Why**: see doc 04. The `system` default leverages
`prefers-reduced-motion` for free. Tri-state (not boolean) so the user
can override the OS hint in either direction.

## Deviation 8: Zoom in Preferences, not status bar

GK puts zoom in the status bar (`bundle:186319-186322`). chajá v1
puts it in the Preferences window only.

**Why**: matches #103 acceptance criteria as written. Status-bar
shortcut is a follow-up issue once the Preferences UI lands and is
shippable.

## Deviation 9: Zoom ladder is GK's, not the issue body's

Issue #103 proposed `75/100/125/150`. Real GK is `80/90/100/110/120/130`.
chajá ports the GK ladder.

**Why**: see doc 05. The issue body was a guess; the audit found the
real values. 10% steps + 80–130% range are saner than 25% steps +
75–150% range.

## Deviation 10: No editor font picker

GK has it (Editor panel). chajá v1 doesn't ship one.

**Why**: see doc 06. chajá has no editor yet.

## Deviation 11: Single global density, not per-zone

#103 prompt left "per-zone density" as a candidate. chajá ships
single global only.

**Why**: see doc 02. No reference, UX confusion, CSS cost. Stick to
single global.

## Deviation 12: Theme apply via `data-theme` attribute, not Helmet `<style>`

GK injects the compiled theme as a `<style>` block via React Helmet
(`bundle:104435`). chajá uses `data-theme="<id>"` on `<html>` with all
10 themes' `:root[data-theme="<id>"]` selectors in CSS.

**Why**: chajá's themes are static (no compiled-from-tokens step).
The Helmet `<style>` mechanism is right when the theme is dynamic
(custom themes, user-edited tokens). chajá's static themes can use
the simpler `data-theme` attribute approach; switching the active
theme is just one DOM mutation, no string compilation.

If chajá adds custom themes in v2, the mechanism shifts to compiled
strings — for now, attribute-based is simpler and faster.

## Summary table

| # | Deviation | Type | Cost | Reversible? |
|---|---|---|---|---|
| 1 | 10 themes vs 4 | Addition | Low (~20KB) | Yes |
| 2 | No high-contrast variants | Subtraction | Zero | Yes (add later) |
| 3 | No custom themes | Subtraction | Zero | Yes (add later) |
| 4 | `auto` vs `SYNC_WITH_SYSTEM` | Naming | Zero | Trivial migration |
| 5 | Density toggle | Addition | Low (~30 LOC CSS) | Yes |
| 6 | Tooltip toggle + delay | Addition | Medium (refactor existing tooltips) | Yes |
| 7 | Animation tri-state | Addition | Low (~20 LOC CSS) | Yes |
| 8 | Zoom in Preferences only | Surface choice | Zero | Add status-bar later |
| 9 | Zoom ladder 80–130% | Correction | Zero | NA |
| 10 | No editor font | Subtraction | Zero | Add when editor ships |
| 11 | Single global density | Subtraction | Zero | Add per-zone later |
| 12 | `data-theme` apply mechanism | Implementation | Zero | Migrate to compiled-string when custom themes ship |

Twelve deviations, all defensible. The PR description should
enumerate them when the implementation lands so reviewers don't ask
"where's GK's color blind toggle?".
