# Tab Operations API

Every state mutation flows through one entry point: **`performTabOperation(op)`** (bundle:2300-2316). It serializes ops onto a saga channel so that two simultaneous user actions (e.g. a click on a tab pill arriving while a `Cmd+W` close is mid-flight) can't race the reducer.

## The dispatcher (bundle:2300-2316)

```js
performTabOperation = Ve => ({
    forbidCallerAcquiredLocks: !0,
    saga: function* performTabOperationSaga(at) {
        const ct = yield at.call(upsertTabOperationEmitter), {
            promise: dt, resolve: ln, reject: dn
        } = yield(0, mn.call)(Dr.createPromiseWithResolveReject);
        return yield(0, mn.call)(ct, {
            type: "OPERATION_REQUESTED",
            operation: Ve,
            resolve: ln,
            reject: dn
        }), yield dt
    }
});
```

What `performTabOperation` does:
1. Lazy-initializes a single shared `tabOperationEmitter` channel (`upsertTabOperationEmitter`).
2. Allocates an external promise.
3. Pushes `{type: "OPERATION_REQUESTED", operation, resolve, reject}` onto the channel.
4. Awaits the promise — settled when the consumer applies the op.

Note `forbidCallerAcquiredLocks: !0` — callers must release any saga locks before invoking, otherwise the consumer (which acquires `CONFIG`/`INDEX` locks while applying) deadlocks.

## The consumer (bundle:1795-2195)

`consumeTabOperations` is a long-running generator that takes from the channel forever. State machine cycles between `channelWorkStates.NOT_RUNNING` → `TAB_CHANGE` → optionally `AFTER_OPERATION_CB` → back to `NOT_RUNNING`.

Three message types are handled:

| Message | Behavior |
|---|---|
| `OPERATION_REQUESTED` | Validates the op, applies the reducer, fires lifecycle hooks (`loadActiveTabContents` / `unloadActiveTabContents`), enqueues the op into a local `Fn` array, sets `TAB_CHANGE`. |
| `TABS_UPDATE_FINISHED` | Cycles to next queue entry; runs `afterOperationCb` if present. |
| `AFTER_OPERATION_CB_FINISHED` | Resolves the promise from step 4 above; back to `NOT_RUNNING`. |

The active-tab content lifecycle (bundle:2316-2360) switches on tab type:

```js
case Oa.tabTypes.REPO: {
    const { repoPath: at } = yield(0, mn.select)(Ma.getCurrentTab);
    yield Ve.call(Ia.openRepo, at, !0);
    break
}
case Oa.permanentTabTypes.REPO_MANAGEMENT:
    yield Ve.call(lo.loadRepoManagementTabContents);
    break;
case Oa.permanentTabTypes.FOCUS_VIEW:
    yield Ve.call($n.loadFocusViewContents);
```

For chajá, this maps to a Solid `createEffect` keyed on `currentTabType()`:

```ts
createEffect(() => {
  const t = currentTab();
  if (!t) return;
  switch (t.type) {
    case "REPO":            void openRepo(t.repoPath!);   break;
    case "REPO_MANAGEMENT": void loadRepoManagement();    break;
    case "RELEASE_NOTES":   /* no-op — content is static */ break;
    case "NEW":             /* no-op — quick-actions are component-local */ break;
  }
});
```

NEW and RELEASE_NOTES don't fire backend calls. REPO_MANAGEMENT does (lists all repos + workspaces).

## Public sagas — one per user-facing action

All exported on the module's `at` (line 1570). Locations and short summaries below — full bodies in the bundle at the cited offsets.

### Open

| Saga | Args | Location | Behavior |
|---|---|---|---|
| `openNewTab()` | — | 2476-2493 | `CREATE` with `{type: NEW}`, auto-switch, fires `NEW_TAB_CREATED` metric. |
| `openRepoInAnotherTab(path, skipMetric?, afterCb?, isWorktree?)` | path: string, ... | 2409-2429 | `switchToRepoTabIfItExists` first; if not found, `CREATE` with `{type: REPO, repoPath}`. Falls through to `openRepoInSelectedTab` if current tab is `NEW`. |
| `openRepoInSelectedTab(path, skipMetric?, afterCb?, isWorktree?)` | same | 2448-2474 | `MUTATE` if current tab is non-permanent (preserves position); else `CREATE`. |
| `openRepoInAnotherTabWithoutSwitching(path, ...)` | same | 2431-2446 | Same as `openRepoInAnotherTab` but with `switchToCreatedTab: false`. |
| `openRepoManagementTab(projectId?, workspaceRepoCount?)` | optional | 2655-2681 | `SWITCH_TO` `permanentTabIds.REPO_MANAGEMENT`; if `projectId` present, scrolls workspace into view; emits `WORKSPACE_VIEWED` metric. |
| `openReleaseNotes()` | — | 2603-2620 | `SWITCH_TO` if a RELEASE_NOTES tab already exists; else `CREATE` with `{type: RELEASE_NOTES, version: ba.releaseNotesVersion}`. |
| `openFocusViewTab(...)` | — | 2699-2718 | **skip** — Launchpad. |

### Switch

| Saga | Location | Behavior |
|---|---|---|
| `selectNextTab()` | 2524-2533 | `SWITCH_TO_NEXT`. |
| `selectPreviousTab()` | 2513-2522 | `SWITCH_TO_PREVIOUS`. |
| `selectTabIndex(n)` | 2535-2545 | `SWITCH_TO_INDEX` with `tabIndex: n` (0-indexed). |
| `switchToRepoTabIfItExists(path, afterCb?)` | 2391-2407 | Searches `tabs` for a REPO with matching `repoPath`; if found, `SWITCH_TO_INDEX`; returns `bool` (whether found). Used as guard inside `openRepoInAnother*`. |

### Close

| Saga | Location | Behavior |
|---|---|---|
| `closeSelectedTab()` | 2547-2559 | `CLOSE` with `tabId = getSelectedTabId()`. |
| `handleCloseTabShortcut()` | 2561-2577 | The Cmd+W handler: if a file-history is open, close it first; else if file-view is open, `tryCloseFileView`; else `CLOSE` selected tab. **Three-stage fallthrough — port the order verbatim, otherwise Cmd+W will close repos when the user wanted to dismiss a file diff.** |
| `closeAllTabsOfType(tabType)` | 2646-2653 | `BULK_CLOSE` matching all tabs of a type. Used internally on workspace switch. |
| `closeOpenedRepoTabsByPaths(pathArray)` | 2682-2697 | `BULK_CLOSE` REPO tabs whose `repoPath` (normalized) appears in the input array. Used when a workspace is removed. |

### Mutate

| Saga | Location | Behavior |
|---|---|---|
| `replaceSelectedTabWithNewTab(forceClosePrivateRepo?, afterCb?)` | 2579-2601 | `MUTATE` to `{type: NEW}` (preserves tabId). If selected is permanent, falls back to `CREATE` instead. Used after a repo's window is closed and we want to leave the user at the NEW screen rather than auto-jumping to another REPO. |

### Reopen

| Saga | Location | Behavior |
|---|---|---|
| `reopenTab(tabId)` | 2621-2627 | `REOPEN` for the given `tabId`. Used by the dropdown menu's "Recently closed" rows. |
| `reopenMostRecentlyClosedTab()` | 2629-2634 | `REOPEN_LAST_CLOSED` (no tabId). Used by Cmd+Shift+T. |

### Toggle

| Saga | Location | Behavior |
|---|---|---|
| `toggleTabDropdown()` | 2495-2511 | Closes any modal in `{ABOUT, ACTIVITY_LOG, CREATE_FILE, FUZZY_FINDER}` first, then dispatches `ToggleTabDropdownMenu` (a plain action — the menu is a Redux-controlled component). See `04-dropdown-menu.md` for the modal reasoning. |

### Misc

| Saga | Location | Behavior |
|---|---|---|
| `persistTabStateToProfile()` | 2373-2381 | Save tabs/selectedTabId/permanentTabs to profile. Called after every successful op (debounced upstream). |
| `scheduleUpdateRepoTabCwd(tabId, cwd)` | 2641-2645 | Updates a REPO tab's stored cwd when a worktree's working directory rotates. |

## What chajá needs to port

For sub-PR 1, the minimum:

1. The 13 op type constants.
2. The `currentTab` / `tabs` / `selectedTabId` / `closedTabs` signals (replace selectors).
3. A queue dispatcher equivalent — Solid doesn't ship channels, so use a `Promise`-chained queue:

```ts
let queue: Promise<void> = Promise.resolve();
export function performTabOperation(op: TabOp): Promise<void> {
  const next = queue.then(() => applyOp(op));
  queue = next.catch(() => {});
  return next;
}
```

This gives the same FIFO + serialized-mutation guarantees without the saga channel infrastructure.

4. The 18 sagas above as `async function`s on an exported `tabOps` object — same shapes, swap `yield call(X, args)` for `await x(args)` and `yield put(action)` for direct signal writes.

5. `loadActiveTabContents` as a `createEffect` keyed on `currentTabType()`.

## Cross-validation

Two claims worth re-grepping:

1. **`forbidCallerAcquiredLocks: !0` causes deadlocks if violated** — the field is set on the dispatcher (bundle:2301). Callers like `openRepoInAnotherTab` (bundle:2410) explicitly do NOT take CONFIG locks; they delegate to the consumer. Violating this in chajá's port would freeze the queue.
2. **`MUTATE` preserves the React component instance** — `replaceSelectedTabWithNewTab` (bundle:2588-2598) reuses `selectedTabId` as the MUTATE op's `tabId`. The reducer (bundle:1795+ MUTATE branch) writes the new `tabParams` into the existing tab record without changing its identity, so the React reconciler keeps the DOM node.
