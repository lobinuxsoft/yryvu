# 07 — Color blind mode + other miscellaneous UI prefs

## Color blind mode

I searched for `colorBlind`, `colorblind`, `Color Blind`, `color-blind`,
`protanopia`, `deuteranopia` — **zero hits** in the bundle.

GK 12.0.1 has **no color blind mode**. The closest accessibility
surface is the `HIGH_CONTRAST_DARK` / `HIGH_CONTRAST_LIGHT` built-in
themes (`bundle:98532-98533`). Those help with low-contrast vision but
not with red-green / blue-yellow color discrimination.

### chajá triage: do not ship a color blind toggle in v1

Reasons:

1. **No GK port surface.** This is a chajá-only addition if shipped.
2. **The lane palette is the only color-blind concern.** Lane colors
   `--lane-0..--lane-9` are the only colors users discriminate
   between (10 distinct hues). Status colors (`--success` /
   `--warning` / `--danger` / `--info`) carry meaning but are spaced
   far enough apart in hue that even severe color-blindness can
   distinguish 3 of the 4.
3. **The 10-theme deviation already addresses it implicitly.** Three
   of the 10 themes (Tokyo Night, Catppuccin, Nord) ship with palettes
   that are color-blind-friendly by virtue of being designed with
   accessibility in mind (Catppuccin and Nord both list a11y as a
   design goal). A user with deuteranopia can pick a theme designed
   around it instead of toggling a "color blind mode" flag.

If a user files a specific issue ("the 4 lanes I need to distinguish
look identical to me"), file a follow-up: **feat(themes): ship
deuteranopia/protanopia-friendly lane palette variant**.

## Other UI panel rows in GK

The full list of UI panel rows from doc 00, with per-row triage:

### NotificationLocation (toast position)

`bundle:346149` `UIPreferences-NotificationLocation`. Uses
`toastPositionOptions` from `bundle:345918`. Persistence path:
`notification.toastPosition` (`bundle:345926`). Values: `top-right`,
`top-left`, `bottom-right`, `bottom-left` (inferred from the toast
animation map at `bundle:104429`).

**Triage**: belongs in `#105 / notifications cluster`, not #103.
Already covered by `gitkraken-notifications` research.

### DateTimeFormat group (Locale + 4 format inputs)

`bundle:346088-346098` group. Header `UIPreferences-DateTimeFormatTitle`,
description with help link `UIPreferences-DateTimeFormatHelp`. Locale
selector + 4 input rows for `DATE` / `DATE_WORD` / `DATE_VERBOSE` /
`DATE_TIME` formats.

**Triage**: belongs in `#102 / general preferences` (this is a
locale + format concern, not a UI look concern). Skip in #103.

### DefaultWorkspaceColor

`bundle:346150-346153`. Color picker for the user's "default workspace"
color (Workspaces is the GK SaaS multi-repo bundle feature).

**Triage**: GK proprietary (Workspaces). **SKIP**. chajá has no
Workspaces equivalent.

### DefaultGroupColor

`bundle:346154-346157`. Same shape as above, for "groups within a
workspace".

**Triage**: GK proprietary. **SKIP**.

### ShowToolbarLabels

`bundle:346158-346161`. Boolean. Persistence: `["ui",
"showToolbarLabels"]` (`bundle:345980`). When false, the top toolbar
shows icon-only buttons; when true, icons + labels.

**Triage**: KEEP for chajá once the toolbar grows icon-only buttons.
Currently chajá's toolbar has just text labels — this is premature.
Defer to follow-up issue tied to a future toolbar redesign.

### ShowLeftPanelWorkflowView

`bundle:346162-346177`. Boolean. Persistence: `["ui",
"showLeftPanelWorkflowView"]` (`bundle:346173`). The "Workflow View"
is a GK-specific left-panel section.

**Triage**: GK proprietary (Workflow View). **SKIP**.

### Spellcheck

`bundle:346178-346181`. Boolean. Persistence: `["ui", "spellcheck"]`
(`bundle:345990`). Affects the commit-message input + any other
text-area Bluebird inputs.

**Triage**: DEFER. chajá has no commit input yet (it lives in cluster
#250 / commit panel, not yet implemented). Once the commit input
lands, file follow-up: **feat(preferences): spellcheck toggle**.

### UseAuthorInitialsForAvatars

`bundle:346182-346185`. Boolean. When true, avatar circles render
"AB" initials of the author's name instead of fetching a Gravatar /
hosting-service avatar URL. Persistence: `["ui",
"useAuthorInitialsForAvatars"]` (referenced at `bundle:345998-346000`).

**Triage**: KEEP, FLAG. chajá v1 doesn't fetch remote avatars at all
(no Gravatar integration, no hosting-service avatar fetching) — every
avatar is initials by default. **The setting is irrelevant until
remote avatars ship**. Defer to a follow-up tied to the
hosting-services D3+ avatar-cache cluster.

### ShowGhostRefsOnHover

`bundle:346186-346189`. Boolean. Graph-cluster setting (refs that
appear on hover instead of being persistently rendered).

**Triage**: graph cluster #155 territory. SKIP from #103.

### HighlightRowsOnRefHover

`bundle:346190-346193`. Boolean. Graph-cluster.

**Triage**: graph cluster #155. SKIP from #103.

### Language

`bundle:346194-346197`. `<select>` over `languageOptions`. Conditional
render: only when `languageOptions.length > 1`. Persistence:
`ui.language` (`bundle:346030`).

**Triage**: i18n cluster (not yet filed). chajá v1 ships ES + EN
strings; once a third language lands, this setting becomes useful.
SKIP from #103.

### BranchVisibilityInCommitGraph

`bundle:346198-346201`. `<select>` with two values: `smart` and `all`.
Graph cluster.

**Triage**: graph cluster #155. SKIP from #103.

### Customizable graph zone toggles

`bundle:345928-345971`. A generated set of checkboxes per zone in
`graphZoneMetaData` (commit author, commit date, commit message,
commit SHA, commit tree, ref, commit changes, etc.).

**Triage**: graph cluster #155. SKIP from #103.

### HideLaunchpadInStatusBar

`bundle:346202-346206`. Conditional render: only when `Fn` truthy
(some account-tier check — Launchpad is a GK SaaS feature).

**Triage**: GK proprietary. SKIP.

## Summary

The UI panel in GK has 14 distinct rows. After triage:

| Outcome | Count | Rows |
|---|---|---|
| KEEP for #103 | 1 | Theme |
| KEEP, deferred to other cluster | 7 | NotificationLocation, DateTimeFormat group, ShowGhostRefsOnHover, HighlightRowsOnRefHover, Language, BranchVisibilityInCommitGraph, GraphZoneToggles |
| KEEP, deferred to follow-up issue | 3 | ShowToolbarLabels, Spellcheck, UseAuthorInitialsForAvatars |
| SKIP (GK proprietary) | 4 | DefaultWorkspaceColor, DefaultGroupColor, ShowLeftPanelWorkflowView, HideLaunchpadInStatusBar |

So chajá's #103 ports exactly **one** GK row (Theme), plus three
chajá-only additions (Density, Tooltips, Animation), plus Zoom (in a
different surface from GK), plus the editor font deferred entirely
(doc 06).

Total chajá UI panel rows: 5 (Theme, Zoom, Density, Tooltips,
Animation). See doc 10 for the chajá panel render contract.
