# 08 — Per-row triage of every GK UI panel row

This doc complements doc 07 by formalizing the triage as a single
table the auditor can copy into the implementation PR description.

## The table

| GK row | Bundle | Persistence | chajá triage | Reason |
|---|---|---|---|---|
| Theme | `346142-346145` | `["ui", "theme"]` | **PORT** | Core #103 surface (doc 01) |
| NotificationLocation | `346146-346149` | `["notification", "toastPosition"]` | **OTHER CLUSTER (#105 notifications)** | Already covered by `gitkraken-notifications/` |
| DateTimeFormat group | `346088-346098` | `["appLocale", "dateFormat", "dateTimeFormat", "dateWordFormat", "dateVerboseFormat"]` | **OTHER CLUSTER (#102 general)** | Locale concern |
| DefaultWorkspaceColor | `346150-346153` | `ProfileSettingPaths.DEFAULT_WORKSPACE_COLOR_ID` | **SKIP** | GK Workspaces proprietary |
| DefaultGroupColor | `346154-346157` | `ProfileSettingPaths.DEFAULT_GROUP_COLOR_ID` | **SKIP** | GK Workspaces proprietary |
| ShowToolbarLabels | `346158-346161` | `["ui", "showToolbarLabels"]` | **DEFER (follow-up)** | chajá toolbar has only text labels today |
| ShowLeftPanelWorkflowView | `346162-346177` | `["ui", "showLeftPanelWorkflowView"]` | **SKIP** | GK Workflow View proprietary |
| Spellcheck | `346178-346181` | `["ui", "spellcheck"]` | **DEFER (follow-up)** | chajá has no commit input yet |
| UseAuthorInitialsForAvatars | `346182-346185` | `["ui", "useAuthorInitialsForAvatars"]` | **DEFER (follow-up)** | chajá has no remote avatar fetching |
| ShowGhostRefsOnHover | `346186-346189` | `["ui", "showGhostRefsOnHover"]` | **OTHER CLUSTER (#155 graph)** | Graph behavior |
| HighlightRowsOnRefHover | `346190-346193` | `["ui", "highlightRowsOnRefHover"]` | **OTHER CLUSTER (#155 graph)** | Graph behavior |
| Language | `346194-346197` | `["ui", "language"]` | **DEFER (follow-up)** | chajá ships only ES+EN today |
| BranchVisibilityInCommitGraph | `346198-346201` | (graph profile setting) | **OTHER CLUSTER (#155 graph)** | Graph behavior |
| Customizable graph zone toggles | `345928-345971` | per-zone in `graphZoneMetaData` | **OTHER CLUSTER (#155 graph)** | Graph layout |
| HideLaunchpadInStatusBar | `346202-346206` | `["hideFocusViewStatusBar"]` | **SKIP** | GK Launchpad proprietary |

## Out-of-panel UI settings ported

| Setting | GK location | chajá triage |
|---|---|---|
| Zoom | Status bar `<select>` (`186319-186322`) | **PORT** to #103 (placed in Preferences window) — doc 05 |
| Editor font / size | Editor panel (`255749-255774`) | **DEFER** — doc 06 |
| Editor tab size / EOL / line numbers / word wrap / syntax highlighting | Editor panel | **DEFER** — doc 06 |

## chajá-only additions (no GK port surface)

| Setting | Justification | Doc |
|---|---|---|
| Density | All modern dev tools have it; small CSS cost | doc 02 |
| Tooltips toggle + delay | a11y + power-user; OS has no equivalent | doc 03 |
| Animation mode (system/always/never) | a11y; honor `prefers-reduced-motion` is free | doc 04 |

## Final chajá UI preferences panel: 5 rows

```
┌─ UI ────────────────────────────────────────┐
│ Theme            [a · Default chajá  ▼]     │  ← KEEP, port adapted (10 themes)
│ Zoom             [100%               ▼]     │  ← KEEP, port (80–130%)
│ Density          [Comfortable        ▼]     │  ← FLAG (chajá-only)
│ Tooltips         [☑] enabled                │  ← FLAG (chajá-only)
│ Tooltip delay    [500           ms]         │  ← FLAG (chajá-only)
│ Animations       [System (OS)        ▼]     │  ← FLAG (chajá-only)
└─────────────────────────────────────────────┘
```

Six controls, one panel — well within the visual budget for a small
preferences tab.
