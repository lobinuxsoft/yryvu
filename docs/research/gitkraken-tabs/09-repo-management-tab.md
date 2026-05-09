# REPO_MANAGEMENT Tab

The `REPO_MANAGEMENT` permanent tab is GK's "all repos" surface — a singleton tab that lists every known repo across local cache + workspaces, with a filter, multi-select, and bulk actions (open in tabs, fetch, pull, etc.).

**For yryvu's port**: the workspaces concept is **out of scope** (GK-proprietary). The yryvu REPO_MANAGEMENT tab degrades to a simpler "all known local repos + clone/init buttons" surface — essentially the recent-repos grid from doc 07 but without the 8-item cap and with bulk actions.

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

1. **Switch-or-no-op**: if not already on REPO_MANAGEMENT tab, `SWITCH_TO` it. **Correction (2026-04-30):** unlike FOCUS_VIEW (which has a `closed` flag toggled by the user), REPO_MANAGEMENT initializes its permanent-tab state slot as `{}` (bundle:2089) — no `closed` flag, no toggle. The icon button is always available; the user "leaves" the view by selecting any other tab.
2. **Workspace scroll**: if `projectId` arg provided, scroll the matching workspace section into view + add to recent-projects list + fire metric. **Skip the workspace logic for yryvu** — no workspaces.

## View modes (bundle:182648)

```js
at.RepoManagementViews = {
    CLONE: "clone",
    INIT: "init"
};
```

Two sub-views — both are modal-like overlays inside the REPO_MANAGEMENT tab body. They surface when the user clicks "Clone" or "Init" buttons in the tab's header. **For yryvu**, these collapse onto the existing #100 dialogs (open / clone / init); the tab just hosts buttons that trigger them.

## Content load (bundle:86354)

```js
at.loadRepoManagementTabContents = () => ({
    saga: function* loadRepoManagementTabContentsSaga(Ve) {
        // ... loads localRepoCache + workspace data + recent repos
    }
});
```

Called from `loadActiveTabContents` switch at bundle:2334-2336 when the user switches into the REPO_MANAGEMENT tab. For yryvu, this maps to a Solid `createEffect` keyed on `currentTabType() === "REPO_MANAGEMENT"` that triggers a backend `list_known_repos` call.

For yryvu's backend, `list_known_repos` needs:
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
│  │ □ yryvu                  feat/foo  ◯ clean   │ │
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

The REPO_MANAGEMENT slot lives in `state.tabs.permanentTabs[REPO_MANAGEMENT]`, but unlike FOCUS_VIEW it carries an empty record `{}` rather than `{closed: boolean}` — confirmed at bundle:2089 vs bundle:2083. It does NOT live in the `tabs[]` array. Implications:

- The Repo Management surface is reached via an **icon button** in the tab leading area (folder glyph), NOT via a tab pill in the strip.
- The icon button is always visible — no closed/open toggle.
- Click on the icon button → `SWITCH_TO permanentTabIds.REPO_MANAGEMENT`. Clicking another tab leaves the view.
- The icon button gets a visual `is-selected` highlight when `selectedTabId === permanentTabIds.REPO_MANAGEMENT` (bundle:330453 `isSelected: xa === Ea.permanentTabIds.REPO_MANAGEMENT`).

## Cross-validation

Three claims worth re-grepping:

1. **REPO_MANAGEMENT renders as `makeTabIcon`, not a pill** — confirmed at bundle:330440-330465. `Ti = makeTabIcon({ icon: ["far","folder"], onClick: ..., isSelected: ... })`. `makeTabIcon` produces an icon button (no label, no × close). An earlier draft of this audit applied the FOCUS_VIEW pill+closed pattern to REPO_MANAGEMENT — that was wrong, corrected via #209.
2. **Permanent tab ID is the literal string** `"REPO_MANAGEMENT"` — confirmed at bundle:228940 (`permanentTabIds = permanentTabTypes`). Don't generate a UUID for it.
3. **Initialization is `{}`, not `{closed: ...}`** — confirmed bundle:2089 vs FOCUS_VIEW at bundle:2083 which sets `{closed: ...}`. The `closed` flag belongs to FOCUS_VIEW only.
