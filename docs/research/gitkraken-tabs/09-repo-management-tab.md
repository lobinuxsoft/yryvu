# REPO_MANAGEMENT Tab

The `REPO_MANAGEMENT` permanent tab is GK's "all repos" surface — a singleton tab that lists every known repo across local cache + workspaces, with a filter, multi-select, and bulk actions (open in tabs, fetch, pull, etc.).

**For chajá's port**: the workspaces concept is **out of scope** (GK-proprietary). The chajá REPO_MANAGEMENT tab degrades to a simpler "all known local repos + clone/init buttons" surface — essentially the recent-repos grid from doc 07 but without the 8-item cap and with bulk actions.

## Open saga (bundle:2655-2681)

```js
at.openRepoManagementTab = (Ve, at) => ({
    saga: function* openRepoManagementTabSaga(ct) {
        if (!(yield(0, mn.select)(Ma.getIsCurrentTabARepoManagementTab))) {
            const Ve = {
                type: Oa.tabOperationTypes.SWITCH_TO,
                tabId: Oa.permanentTabIds.REPO_MANAGEMENT
            };
            yield ct.call(performTabOperation, Ve)
        }
        const dt = Ve ? lodash.get([Ve], yield(0, mn.select)(Nr.getProjectsById)) : void 0;
        if (dt) {
            const Ve = document.getElementById(getCollapsibleWorkspaceReposId(dt.id));
            if (Ve && Ve.scrollIntoView({ behavior: "smooth" }), 
                yield ct.call(gr.addToRecentProjectsList, dt.id, dt.name),
                ...) {
                // workspace metric
            }
        }
    }
});
```

Two phases:

1. **Switch-or-no-op**: if not already on REPO_MANAGEMENT tab, `SWITCH_TO` it (the tab always exists as a permanent singleton, only its `closed` flag flips).
2. **Workspace scroll**: if `projectId` arg provided, scroll the matching workspace section into view + add to recent-projects list + fire metric. **Skip the workspace logic for chajá** — no workspaces.

## View modes (bundle:182648)

```js
at.RepoManagementViews = {
    CLONE: "clone",
    INIT: "init"
};
```

Two sub-views — both are modal-like overlays inside the REPO_MANAGEMENT tab body. They surface when the user clicks "Clone" or "Init" buttons in the tab's header. **For chajá**, these collapse onto the existing #100 dialogs (open / clone / init); the tab just hosts buttons that trigger them.

## Content load (bundle:86354)

```js
at.loadRepoManagementTabContents = () => ({
    saga: function* loadRepoManagementTabContentsSaga(Ve) {
        // ... loads localRepoCache + workspace data + recent repos
    }
});
```

Called from `loadActiveTabContents` switch at bundle:2334-2336 when the user switches into the REPO_MANAGEMENT tab. For chajá, this maps to a Solid `createEffect` keyed on `currentTabType() === "REPO_MANAGEMENT"` that triggers a backend `list_known_repos` call.

For chajá's backend, `list_known_repos` needs:
- The recent-repos cache (already used by NEW tab via `getRecentLocalRepos`).
- Any persisted "favorite" repos (separate concept, deferred — doesn't block).
- For each: scan `.git/HEAD` to surface current branch + dirty status.

## Layout (port-friendly)

```
┌────────────────────────────────────────────────────┐
│  [Open] [Clone] [Init]              [filter ____ ] │
│                                                    │
│  All Repositories  (12)                            │
│  ┌──────────────────────────────────────────────┐ │
│  │ □ chaja                  feat/foo  ◯ clean   │ │
│  │ □ oh-my-engine           main      ● 3 dirty │ │
│  │ □ CapyDeploy             develop   ◯ clean   │ │
│  │ ...                                           │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  [Selected: 0]  [Open in tabs] [Fetch] [Pull]      │
└────────────────────────────────────────────────────┘
```

Actions bar at the bottom enables bulk ops on multi-selected repos. v1 can ship without bulk ops — single-row click → `openRepoInAnotherTab(path)`.

## Permanent tab semantics

Reminder from `01-tab-types-and-store.md`: the REPO_MANAGEMENT tab is a singleton stored in `state.tabs.permanentTabs[REPO_MANAGEMENT]` with shape `{closed: boolean}`. It does NOT live in the `tabs[]` array (which is transient tabs only). Implications:

- It doesn't show up in the strip unless `closed: false`.
- Closing it just sets `closed: true` — the tab record is preserved.
- Reopening uses `SWITCH_TO permanentTabIds.REPO_MANAGEMENT` which both un-closes and selects.
- The strip render places permanent tabs at the **LEFT edge** of the strip, before all transient tabs and before the `+` button. Confirmed by the JSX at `bundle:330605-330614` (see `03-tab-bar-chrome.md` for the full layout diagram).

## Cross-validation

Two claims worth re-grepping:

1. **Permanent tabs render position is LEFT-of-transient** — confirmed at bundle:330605-330614 where `Ti` (REPO_MANAGEMENT pill, defined at bundle:330445) is the first child of the `tabs-bar` div, before the nested flex container that holds the sortable transient strip + `+` button. (An earlier draft of this audit claimed right-edge — that was inverted.)
2. **Permanent tab ID is the literal string** `"REPO_MANAGEMENT"` — confirmed at bundle:228940 (`permanentTabIds = permanentTabTypes`). Don't generate a UUID for it.
