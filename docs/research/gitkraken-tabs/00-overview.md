# GitKraken Tab System — Audit Overview

Bundle reference: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js` (12.0.1).
Pretty fork: `/tmp/gk-bundle-pretty.js` (regenerable via `bunx js-beautify` — see `project_chaja.md`). Line numbers below are **pretty-fork offsets**.

This audit unblocks **#135** (tab bar overhaul) — the chajá tab strip currently renders only `REPO`-type pills with a dead `+` button. GK ships a full tab subsystem: 6 tab types, 13 operation types, a queue-serialized dispatcher, persistence to profile, dropdown menu with closed-tabs stack, and 9 keybinds. This document tree maps every piece against bundle offsets so each sub-PR can port its slice 1:1.

## Module boundary

The whole subsystem ships from the module registered at `bundle:228926` (`60028(Ve, at) { ... }`). Public exports cover constants (tab types, operation types, channel states, IDs) and are consumed by:

- The saga-based ops API (`bundle:1795-2720`), which serializes mutations through a single `tabOperationEmitter` channel.
- The reducer/store layer (`bundle:371000-371200` for closed-tabs handlers; selectors at `bundle:372861-372931`).
- The tab-bar React tree (`bundle:330240-330318`), wrapped in a `react-sortable-list` HOC for drag-reorder.
- The keybind registry (`bundle:89122-89131`).

## Recommended sub-PR split for #135

Sequenced so each lands an end-to-end vertical slice without breaking the build:

| Sub-PR | Scope | Doc(s) | Depends on |
|---|---|---|---|
| 1 | Tab type model + store + queue dispatcher | 01, 02 | — |
| 2 | Tab bar chrome (pills + active styling + close button) | 03 | 1 |
| 3 | `+` button → NEW tab, NEW tab quick actions | 03, 07 | 1, 2, **#100** open/clone/init dialogs |
| 4 | Dropdown chevron + Open tabs / Recently closed sections | 04, 06 | 1, 2 |
| 5 | Keybinds (Cmd+T/W/Tab/Shift+Tab/1-9/Shift+T) | 05 | 1 |
| 6 | RELEASE_NOTES tab type + content | 08 | 1, 4 |
| 7 | REPO_MANAGEMENT tab type + content | 09 | 1, 4 |
| 8 | Drag-reorder tabs (= **#39**) | 10 | 2 |

Sub-PRs 6 and 7 are independent of each other and can land in any order. Sub-PR 8 is **#39** — keep it as its own GitHub issue rather than folding it under #135.

Out-of-scope: `CLI` tab type (chajá ships no terminal), `FOCUS_VIEW` (GK Launchpad is proprietary). Both surface in the bundle but stay unported. See `11-out-of-scope-proprietary.md`.

## File map

| File | Topic |
|---|---|
| `00-overview.md` | This file |
| `01-tab-types-and-store.md` | `tabTypes` enum, `permanentTabIds`, store shape, `persistTabStateToProfile` |
| `02-tab-ops-api.md` | All 18 sagas, `performTabOperation` queue, `consumeTabOperations` channel |
| `03-tab-bar-chrome.md` | Tab strip render, tab pills, `+` button, dropdown chevron |
| `04-dropdown-menu.md` | `toggleTabDropdown`, modal pre-flight, 3-section menu |
| `05-keybinds.md` | Tabs registry + 9 keybinds + handler wiring |
| `06-closed-tabs-stack.md` | `closedTabs` LIFO, `reopenTab` / `reopenMostRecentlyClosedTab`, persistence |
| `07-new-tab-quick-actions.md` | NEW tab content, "What's next?", recent repos grid |
| `08-release-notes-tab.md` | `RELEASE_NOTES` type, version embed, content source |
| `09-repo-management-tab.md` | `REPO_MANAGEMENT` permanent tab, workspace integration |
| `10-drag-reorder.md` | `react-sortable-list` HOC, `MOVE` op, `arrayMove` |
| `11-out-of-scope-proprietary.md` | CLI, FOCUS_VIEW, in-app terminal — what we skip and why |

## Validation policy

Every claim in these docs cites a `bundle:OFFSET` so it can be re-verified with `sed -n 'OFFSET,OFFSET+5p' /tmp/gk-bundle-pretty.js`. Per `feedback_validate_research_primary.md`, structural claims (sticky/scroll, hierarchy, lifecycle order) MUST be grep-confirmed before being acted on by an implementation PR. The 5 most surprising claims in this audit have already been re-validated against the bundle — see the "Cross-validation" section at the bottom of each affected doc.

## Port policy

Per `feedback_copy_gk_code_adapted.md` (2026-04-30), porting code verbatim from the bundle and adapting it to the chajá stack is authorized. The expected pattern per sub-PR:

1. Extract the relevant module from `/tmp/gk-bundle-pretty.js` (the offsets in these docs).
2. Drop into a scratch `.ts` for reference.
3. Re-implement in idiomatic Solid (signals instead of Redux sagas, `createSignal` / `createMemo` instead of selectors, `for await` instead of channel takes).
4. Commit message references the bundle offset: `feat(tabs): port queue dispatcher (bundle @ 1795-2195)`.

GK is AGPL-3.0; chajá is AGPL-3.0; the port is license-clean as long as we ship source.
