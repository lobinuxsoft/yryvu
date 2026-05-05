# Out of Scope — Proprietary Pieces

These tab subsystem features surface in the bundle but **do not get ported** to chajá, either because they're GK-proprietary cloud features or because they overlap with chajá-deferred surfaces.

## CLI tab type

**Bundle**: `tabTypes.CLI = "CLI"` (bundle:228933), `tabTypesThatCanHaveATerminal = [REPO]` (bundle:228942 — REPO tabs can host an embedded terminal pane).

**Why skip**: chajá ships no terminal. The embedded-terminal feature is tracked separately in **#25** and is currently `priority:low`. Skipping CLI as a tab type doesn't block #25 — when/if a terminal lands, it'll be a pane inside the REPO tab (matches GK), not a top-level tab type.

**Implication**: chajá's `TabType` union omits `CLI`. The strip never renders a CLI pill. The dropdown menu's "New tab types" section omits CLI.

## FOCUS_VIEW tab (Launchpad)

**Bundle**: `permanentTabTypes.FOCUS_VIEW = "FOCUS_VIEW"` (bundle:228938). Renderer at `bundle:142803-142808`. Saga `openFocusViewTab` at `bundle:2699-2718`.

**Why skip**: GK Launchpad is a paid SaaS feature — aggregates PRs / issues / branches across all the user's connected repos via GitKraken-hosted services. The aggregation backend is proprietary. The renderer assumes the SaaS API.

**Implication**: chajá's `TabType` union omits `FOCUS_VIEW`. The `permanentTabs` map only carries `REPO_MANAGEMENT`. The strip's permanent-tabs render path skips the FOCUS_VIEW conditional.

A chajá-native version of this surface would be **#99** (per-repo PR review mode panel) and **#97** (cross-provider issue tracker panel) — but neither is a tab type, both are right-panel inspectors. No port path for FOCUS_VIEW.

## CLOUD_PATCHES (related, surfaces in tab strip context)

**Bundle**: not a tab type, but a related GK surface. SaaS-only, skipped.

**Why mentioned**: the dropdown menu's `getReopenableTabs` selector (bundle:372932) filters by user features — for cloud-patches-related tabs, free-tier users can't reopen. **For chajá, drop the user-features filter entirely** (covered in `04-dropdown-menu.md`).

## Tab metrics / telemetry

**Bundle**: `sendTabMetric` (bundle:1570 export), `sendTabMetrics` (1570), `recordMetric` calls inside every tab op saga (e.g. `openNewTab` fires `oTelMetrics.NEW_TAB_CREATED` at bundle:2487).

**Why skip**: chajá ships no telemetry. The metric calls all dispatch through `oTelMetrics` to a GK-hosted OpenTelemetry collector.

**Implication**: every saga's metric call (typically the last `yield Ve.spawn(dr.recordMetric, ...)`) gets dropped in the chajá port. Don't emit telemetry events. Don't even emit local events with the same names — leaves the door open for someone to wire telemetry later by mistake.

## `tabsIpcMessageChannels.OPEN_REPO_MANAGEMENT_TAB`

**Bundle**: bundle:228963. Used to open the REPO_MANAGEMENT tab from a child process (via Electron IPC).

**Why skip**: chajá uses Tauri's command IPC, not Electron's main↔renderer message bus. The REPO_MANAGEMENT tab opens via direct call to `openRepoManagementTab()` from the chajá frontend. No external process triggers it.

**Implication**: no equivalent constant needed.

## In-app review mode tab integration

**Bundle**: `ReviewModeStarted` reducer handler at bundle:309861 (auto-closes the dropdown when review mode starts).

**Why skip**: review mode is GK's per-PR review surface — proprietary. Chajá's #99 (per-repo PR review mode panel) is a chajá-native re-imagining inside the right panel, not a tab-strip-level concept.

**Implication**: drop the `ReviewModeStarted` handler from the dropdown's auto-close triggers (covered in `04-dropdown-menu.md`).

## Workspaces (referenced by REPO_MANAGEMENT tab)

**Bundle**: workspace logic permeates `openRepoManagementTab` (bundle:2664-2680) and `loadRepoManagementTabContents` (bundle:86354).

**Why skip**: workspaces (`projectTypes.shared` etc.) are GK-proprietary collaboration features.

**Implication**: chajá's REPO_MANAGEMENT tab degrades to a single ungrouped list of all known local repos — no workspace sections, no "scroll workspace into view" behavior. See `09-repo-management-tab.md`.

## Quick summary

| Feature | Bundle ref | Skip reason | Chajá replacement |
|---|---|---|---|
| `CLI` tab type | 228933 | no terminal | none (terminal is #25, separate scope) |
| `FOCUS_VIEW` permanent tab | 228938 | proprietary Launchpad | none |
| Cloud patches | various | proprietary | none |
| Telemetry calls | 1570 | no telemetry | drop |
| Workspace logic | 2664+, 86354 | proprietary | flat repo list |
| Electron IPC channels | 228963 | not Electron | direct call |
| Review mode integration | 309861 | proprietary | none (#99 is not tab-level) |
