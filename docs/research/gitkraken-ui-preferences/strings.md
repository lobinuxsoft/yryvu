# strings — i18n keys touched by the UI preferences cluster

All strings the GK UI panel uses, plus the chajá-specific additions
that the chajá panel introduces. Bundle citations for each GK string
inline.

## GK strings the chajá panel reuses

These keys exist in the GK i18n bundle. chajá's i18n file should
duplicate them (English) with translations for ES.

| Key | English (inferred from GK label) | Bundle |
|---|---|---|
| `UiPreferences` (panel title / tab label) | "UI" | `bundle:119207`, `346142` |
| `UIPreferences-Theme` | "Theme" | `bundle:346145` |
| `SyncWithSystem` | "Sync with System" | `bundle:411337` |

## chajá-specific strings (new)

These are not in the GK bundle. They need new entries in chajá's
i18n. Suggested keys + English values:

| Key | English | Notes |
|---|---|---|
| `UiPreferences-Title` | "UI" | matches GK |
| `UiPreferences-Theme` | "Theme" | matches GK `UIPreferences-Theme` |
| `UiPreferences-Theme-Auto` | "Sync with System" | matches GK `SyncWithSystem` semantics, shorter chajá id `auto` |
| `UiPreferences-Zoom` | "Zoom" | new — GK has zoom in status bar, no key |
| `UiPreferences-Density` | "Density" | new (chajá-only setting) |
| `UiPreferences-Density-Comfortable` | "Comfortable" | new |
| `UiPreferences-Density-Compact` | "Compact" | new |
| `UiPreferences-TooltipsEnabled` | "Show tooltips on hover" | new (chajá-only) |
| `UiPreferences-TooltipDelayMs` | "Tooltip delay (ms)" | new |
| `UiPreferences-Animations` | "Animations" | new (chajá-only) |
| `UiPreferences-Animations-System` | "Honor system setting" | new |
| `UiPreferences-Animations-Always` | "Always on" | new |
| `UiPreferences-Animations-Never` | "Never" | new |

## ES translations (suggested)

| Key | Spanish |
|---|---|
| `UiPreferences-Title` | "UI" |
| `UiPreferences-Theme` | "Tema" |
| `UiPreferences-Theme-Auto` | "Sincronizar con el sistema" |
| `UiPreferences-Zoom` | "Zoom" |
| `UiPreferences-Density` | "Densidad" |
| `UiPreferences-Density-Comfortable` | "Cómoda" |
| `UiPreferences-Density-Compact` | "Compacta" |
| `UiPreferences-TooltipsEnabled` | "Mostrar tooltips al pasar el cursor" |
| `UiPreferences-TooltipDelayMs` | "Retraso del tooltip (ms)" |
| `UiPreferences-Animations` | "Animaciones" |
| `UiPreferences-Animations-System` | "Seguir configuración del sistema" |
| `UiPreferences-Animations-Always` | "Siempre activadas" |
| `UiPreferences-Animations-Never` | "Nunca" |

The theme **names** (a · Default chajá, b · Tokyo Night, etc.) are
**not localized** — they're proper nouns / brand-attached labels and
shipping translated theme names is more confusing than helpful.

## Strings the chajá panel does NOT use (out of #103 scope)

For reference, the GK UI panel uses these keys but chajá does not
port them in #103 (per per-row triage in doc 07/08):

| Key | Bundle | Why chajá skips |
|---|---|---|
| `UIPreferences-NotificationLocation` | `bundle:346149` | #105 notifications cluster |
| `UIPreferences-DateTimeFormatHelp` | `bundle:346089` | #102 general |
| `UIPreferences-DateTimeFormatHelpLinkText` | `bundle:346093` | #102 general |
| `UIPreferences-DateTimeFormatTitle` | `bundle:346094` | #102 general |
| `UIPreferences-Locale` | `bundle:346098` | #102 general |
| `UIPreferences-DefaultWorkspaceColor` | `bundle:346153` | GK proprietary (Workspaces) |
| `UIPreferences-DefaultGroupColor` | `bundle:346157` | GK proprietary (Workspaces) |
| `UIPreferences-ShowToolbarLabels` | `bundle:346161` | follow-up issue |
| `UIPreferences-ShowLeftPanelWorkflowView` | `bundle:346177` | GK proprietary (Workflow View) |
| `UIPreferences-Spellcheck` | `bundle:346181` | follow-up issue (no commit input) |
| `UIPreferences-UseAuthorInitialsForAvatars` | `bundle:346185` | follow-up issue (no remote avatars) |
| `UIPreferences-ShowGhostRefsOnHover` | `bundle:346189` | #155 graph cluster |
| `UIPreferences-HighlightRowsOnRefHover` | `bundle:346193` | #155 graph cluster |
| `UIPreferences-Language` | `bundle:346197` | follow-up issue (only ES+EN today) |
| `UIPreferences-BranchVisibilityInCommitGraph` | `bundle:346201` | #155 graph cluster |
| `UIPreferences-BranchVisibilityInCommitGraphAll` | `bundle:345916` | #155 graph cluster |
| `UIPreferences-BranchVisibilityInCommitGraphSmart` | `bundle:345918` | #155 graph cluster |
| `UIPreferences-CompactGraphColumnLayout` | `bundle:303205` | #155 graph cluster (context menu) |
| `UIPreferences-ResetGraphColumnsToDefaultLayout` | `bundle:303220` | #155 graph cluster |
| `UIPreferences-ResetGraphColumnsToCompactLayout` | `bundle:303225` | #155 graph cluster |
| `UIPreferences-ShowCommit*InGraph` (5 zone toggles) | `bundle:356229+` | #155 graph cluster |
| `UIPreferences-ShowCommitDescriptionInGraph` | `bundle:345961` | #155 graph cluster |
| `EditorPreferences-Font` | `bundle:255749` | deferred (no editor) |
| `EditorPreferences-FontSize` | `bundle:255753` | deferred |
| `EditorPreferences-ShowOnlyMonospace` | `bundle:255737` | deferred |

These are documented for cross-reference completeness — they belong
to other clusters' research.
