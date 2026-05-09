# 00 — UI preferences overview

Audit of GitKraken's `Preferences > UI` tab — the "what controls the
look of the app" surface that maps to yryvu issue #103
(`feat(preferences): UI preferences (theme / zoom / font / density /
tooltips / animation)`).

Bundle: `app/src/render/static/entryPoints/main/render.bundle.js`,
prettified to `/tmp/gk-bundle-pretty.js` (414128 lines). Citations use
`bundle:LINE` against the prettified file.

## Top-level finding (correction vs. issue #103 body)

The prompt for #103 listed six expected sub-settings: theme, zoom, font,
density, tooltips, animation. **Only one of those six (theme) is in
GK's actual `UIPreferences` panel.** Of the remaining five:

| Setting | In GK UIPreferences panel? | Where it actually lives | Triage |
|---|---|---|---|
| Theme | YES (`bundle:346142-346145`) | `Preferences > UI > Theme` | KEEP, port |
| Zoom | NO | Status-bar dropdown bottom-right of every window (`bundle:186319-186322`) | KEEP, but as a status-bar control |
| Editor font | NO | `Preferences > Editor > Font` (`bundle:255749`) | DEFER (no Monaco in yryvu yet) |
| Density | does not exist as a setting | (graph layout has compact mode but not surfaced as UI setting) | SKIP (yryvu deviation) |
| Tooltip toggle | does not exist | (only a tab-hover delay constant `TAB_TOOLTIP_HOVER_MS`) | SKIP |
| Animation toggle | does not exist | (no global `animationsEnabled` flag) | SKIP |

The yryvu scope cannot be ported 1:1 — three of the six settings have
no GK analogue. See `09-yryvu-deviations.md` for the rip list.

## What GK's UI preferences panel actually contains

Source render: `bundle:346136-346206`. Tab dispatcher: `bundle:27012`.
Tab metadata: `bundle:119206-119209` (label `"UIPreferences"`, icon
`["fas", "paint-brush"]`).

Rows in render order:

| Row | Bundle line | Control | Notes |
|---|---|---|---|
| Theme | `bundle:346142-346145` | `<select>` populated from `themeOptions` | KEEP — yryvu ports |
| NotificationLocation | `bundle:346146-346149` | `<select>` (toast positions) | Belongs in #105 (notifications cluster) |
| DateTimeFormat (Locale + 4 inputs) | `bundle:346088-346098` | Group of locale selector + format strings | Belongs in #102 (general) — out of UI panel scope |
| DefaultWorkspaceColor | `bundle:346150-346153` | Color picker | GK proprietary (Workspaces) — SKIP |
| DefaultGroupColor | `bundle:346154-346157` | Color picker | GK proprietary (Workspaces) — SKIP |
| ShowToolbarLabels | `bundle:346158-346161` | Checkbox | KEEP (port if yryvu toolbar grows icon-only buttons) |
| ShowLeftPanelWorkflowView | `bundle:346162-346177` | Checkbox | GK proprietary (Workflow view) — SKIP |
| Spellcheck | `bundle:346178-346181` | Checkbox | DEFER (yryvu has no commit input yet) |
| UseAuthorInitialsForAvatars | `bundle:346182-346185` | Checkbox | KEEP (small UX win, no infra) |
| ShowGhostRefsOnHover | `bundle:346186-346189` | Checkbox | DEFER (graph-cluster) |
| HighlightRowsOnRefHover | `bundle:346190-346193` | Checkbox | DEFER (graph-cluster) |
| Language | `bundle:346194-346197` | `<select>` (only renders when >1 language) | DEFER (no i18n yet) |
| BranchVisibilityInCommitGraph | `bundle:346198-346201` | `<select>` (smart / all) | Graph cluster #155 (already covered there) |
| Customizable graph zone toggles | `bundle:345928-345971` | Generated checkboxes per `graphZoneMetaData` | Graph cluster #155 |
| HideLaunchpadInStatusBar | `bundle:346202-346206` | Checkbox (only when `Fn` truthy) | GK proprietary (Launchpad) — SKIP |

So GK's UI panel is only ~3 rows that actually map to yryvu's #103: Theme,
ShowToolbarLabels, UseAuthorInitialsForAvatars. The rest are either
proprietary or belong to other clusters.

## What yryvu #103 wants that GK doesn't have

The original issue body proposed `density` (per-zone or global),
`tooltipBehavior`, `animationsEnabled`, and a hard 75/100/125/150 zoom
ladder. Those are **yryvu deviations**, not GK ports. `09-yryvu-deviations.md`
documents each.

## Theme — the one real KEEP

GK's theme system (`bundle:411302-411388`) is dynamic:

- Built-in theme keys are 4: `dark`, `light`, `dark-high-contrast`,
  `light-high-contrast` (`bundle:98529-98534`). The actual default is
  `dark` (`bundle:218670` `DEFAULT_THEME = THEME.DARK`).
- Themes live in Redux `state.theme.appThemes` as a map keyed by id
  (`bundle:411316`). Initial state is `appThemes: {}` (`bundle:165967`)
  — themes are loaded from disk at startup.
- Each theme has `{ name, scheme: "dark"|"light", isBuiltInTheme,
  /* css-var key→value map */ }`. Schemes drive the Monaco editor base
  theme (vs / vs-dark) and PR diff styling.
- A "SYNC_WITH_SYSTEM" pseudo-theme exists (`bundle:218670`,
  `bundle:411322`) that resolves to `state.theme.osTheme` at read time.
- Custom themes are supported (`isBuiltInTheme === false`) — users can
  ship their own theme files that GK loads alongside built-ins.
- The compiled theme is rendered as a **dynamic `:root { ... }`** CSS
  block injected via React Helmet (`bundle:104435`) — exactly the
  mechanism yryvu's design-previews use.

This is *substantially more sophisticated* than yryvu's #103 body
suggests. Yryvu's spec is closer to a static "10 hard-coded themes"
design — see doc 01 for the deviation rationale and docs 11/12 for how
to align with GK's compiled-theme-string approach.

## Zoom — present, but in a different surface

GK exposes zoom as a `<select>` on the **status bar**
(`bundle:186319-186322`), not in the Preferences window. Discrete
factors: `[1.3, 1.2, 1.1, 1.0, 0.9, 0.8]` (`bundle:256353` —
`ZOOM_FACTORS = [1.3, 1.2, 1.1, An, .9, .8]` where `An =
DEFAULT_ZOOM_FACTOR = 1`). Persisted at profile path `["zoom"]`
(`bundle:4754`) — top-level on the profile, NOT under `ui`.

#103 proposed 75/100/125/150. **GK actually uses 80/90/100/110/120/130.**
See doc 05 for the full implementation.

## Editor font — Editor panel, not UI panel

Editor font and font size live in the EDITOR preferences tab
(`bundle:255749` `EditorPreferences-Font`, `bundle:255753`
`EditorPreferences-FontSize`). They're persisted at profile path
`["editor", "fontFamily"]` (`bundle:10632`). yryvu has no Monaco /
diff editor yet (#256 cluster), so these are deferred. See doc 06.

## What doesn't exist in GK at all

Three of the six yryvu #103 items have **no GK analogue** in any
preferences panel:

1. **Density** (compact / standard / comfortable). Not a user-facing
   setting. The graph has a "compact" column layout option
   (`bundle:303205` `UIPreferences-CompactGraphColumnLayout`) but
   that's exposed as a graph context-menu item, not a preferences
   toggle.
2. **Tooltip behavior / global toggle / delay setting.** No setting.
   The constant `TAB_TOOLTIP_HOVER_MS` (referenced at `bundle:1769`) is
   a hard-coded ms delay for the **tabs bar tooltip only**. Tooltips
   elsewhere (toolbar, commit-row) have no delay configuration.
3. **Animations enabled / motion toggle.** No setting. GK does honor
   `prefers-reduced-motion` in some Bootstrap-derived components, but
   there is no UI to toggle.

These are yryvu deviations. See doc 09 for the rationale and doc 04 for
why we still want to ship them.

## Document tree

| Doc | Topic |
|---|---|
| 00-overview.md | This file |
| 01-theme-preference.md | GK theme model (built-ins, custom, compiled string, OS-follow) |
| 02-density.md | Why density doesn't exist in GK; yryvu-only flag |
| 03-tooltip-behavior.md | Why GK has no tooltip preference; yryvu-only flag |
| 04-animation.md | Why GK has no animation preference; yryvu-only flag |
| 05-zoom.md | GK zoom: status-bar control + ZOOM_FACTORS ladder |
| 06-editor-font.md | GK editor font (Editor panel, deferred for yryvu) |
| 07-color-blind-and-other-misc.md | Color blind audit (none in GK), other UI panel bits |
| 08-other-ui-panel-rows-triage.md | Per-row triage of every row GK ships in UI panel |
| 09-yryvu-deviations.md | Explicit list of yryvu-only choices vs GK |
| 10-acceptance-translation.md | #103 split into yryvu sub-issues + sub-PR plan |
| 11-backend-implementation-notes.md | Rust struct shape + serde defaults + IPC (yryvu-bridge) |
| 12-frontend-implementation-notes.md | Solid signals + effects + CSS file layout + Tooltip refactor |
| strings.md | i18n strings the UI panel uses, verbatim |

## Triage summary (per six-item original scope)

| Item | Triage | Why |
|---|---|---|
| Theme | **KEEP, port adapted** | GK has a richer model than #103 assumes; doc 01 + 11 align yryvu's 10-theme set with GK's compiled-string mechanism |
| Zoom | **KEEP, port** | Real feature; correct ladder is 80–130%, not 75–150%. Where to surface (status bar vs preferences) is doc 05 |
| Density | **FLAG (yryvu-only)** | No GK analogue; yryvu ships with a single global flag (compact / comfortable). Doc 02 |
| Tooltip toggle | **FLAG (yryvu-only)** | No GK analogue; ship as a single global on/off + ms delay. Doc 03 |
| Animation toggle | **FLAG (yryvu-only)** | No GK analogue; ship as a single global on/off + honor `prefers-reduced-motion`. Doc 04 |
| Editor font | **DEFER** | GK has it but in EDITOR panel; yryvu has no editor yet. Doc 06 |

## Cross-validation note

I re-grepped the load-bearing citations in this doc:

- `[Fn.tabTypes.UI]` (UI panel dispatcher) at `bundle:27012`: confirmed.
- `[gn.UI]: { label: "UIPreferences", icon: ["fas", "paint-brush"] }`
  at `bundle:119206-119209`: confirmed.
- `ZOOM_FACTORS = [1.3, 1.2, 1.1, An, .9, .8]` at `bundle:256353`:
  confirmed.
- `at.SET_THEME = "SET_THEME"` at `bundle:4740`: confirmed.
- `THEME = { DARK, LIGHT, HIGH_CONTRAST_DARK, HIGH_CONTRAST_LIGHT }` at
  `bundle:98529-98534`: confirmed.
- `at.themeSchemeTypes = { DARK: "dark", LIGHT: "light" }` at
  `bundle:179521-179523`: confirmed.

No bundle citation in the doc set was speculative; every claim has a
real line. The icon `["fas", "palette"]` referenced in the prompt is
**wrong** — GK uses `paint-brush`. Call this **Inversion #1**.

## yryvu-deviation FLAGs surfaced in this overview

1. **Three of #103's six settings are not GK ports.** Density / tooltip
   toggle / animation toggle are yryvu additions justified by genre
   conventions (VSCode, IntelliJ both have them). Doc 09 makes the
   case.
2. **Theme model is much richer in GK than in yryvu's design-previews.**
   GK has compiled-theme-strings, custom themes, and a 4-state built-in
   set (dark/light + high-contrast variants). yryvu ships 10 hardcoded
   themes with no custom-theme support. Doc 01 + 11 align both worlds.
3. **Zoom ladder is wrong in #103 body** (75/100/125/150). Real GK
   ladder is 80/90/100/110/120/130. Doc 05 ports the GK ladder.
4. **Zoom is in status-bar not preferences in GK.** yryvu #103 proposes
   it under Preferences. Choice: ship the ladder under Preferences
   (matches #103 acceptance) AND optionally a status-bar shortcut
   later. Doc 05 documents tradeoff.
