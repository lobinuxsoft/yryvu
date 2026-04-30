# Closed Tabs Stack

The dropdown's "Closed Recently" section reads from `state.tabs.closedTabs`, an unbounded LIFO of full tab snapshots. Each entry preserves enough state to recreate the tab — for REPO tabs, that means `{id, type: "REPO", repoPath, isWorktree?}`.

## Reducer (bundle:371172-371180)

```js
.addHandler(gn.TabsClosed, ((Ve, { closedTabs: at }) =>
    setIfNotSame("closedTabs", [...Ve.closedTabs, ...at], Ve)
))
.addHandler(gn.TabReopened, ((Ve, { reopenedTabId: at }) => {
    const ct = Ve.closedTabs;
    return 0 === ct.length ? Ve : setIfNotSame("closedTabs",
        lodash.filter(Ve => Ve.id !== at, ct), Ve)
}))
```

Two operations:

1. **`TabsClosed`** — appends the closed tab(s) to the end of the array (FIFO append → LIFO read).
2. **`TabReopened`** — removes the entry by `id` (so the same tab can't be re-reopened).

Note: `TabsClosed` accepts an array (`[...Ve.closedTabs, ...at]`) so a single `BULK_CLOSE` op can push N entries at once. Order matches the order they were closed.

## Reading

| Selector | Returns | Location |
|---|---|---|
| `getClosedTabs` | full array | bundle:372928 |
| `getReopenableTabs` | array filtered by user features | bundle:372932 |
| `getMostRecentlyClosed` | `lodash.last(closedTabs)` | bundle:372930 |
| `getCanReopenTabs` | `!isEmpty(closedTabs)` | bundle:~372930 |

`getReopenableTabs` exists because GK gates some tab types behind paid tiers. **For chajá, this collapses to `closedTabs()` directly — no tier filter.**

## Reopen ops

Two sagas (already covered in `02-tab-ops-api.md`, repeated here for reference):

```js
at.reopenTab = Ve => ({
    saga: function* (at) {
        yield at.call(performTabOperation, {
            type: Oa.tabOperationTypes.REOPEN,
            tabId: Ve
        })
    }
});

at.reopenMostRecentlyClosedTab = () => ({
    saga: function* (Ve) {
        yield Ve.call(performTabOperation, {
            type: Oa.tabOperationTypes.REOPEN_LAST_CLOSED
        })
    }
});
```

The `REOPEN` reducer branch (in `consumeTabOperations`):
1. Looks up the entry in `closedTabs` by `tabId`.
2. Re-inserts it into `tabs` at its **original index** (preserved as part of the snapshot).
3. Dispatches `TabReopened` to remove it from the closed-tabs stack.
4. Switches to it (auto-switch on reopen is not configurable).

The `REOPEN_LAST_CLOSED` branch is the same but reads `lodash.last(closedTabs)` instead of looking up by ID.

## Stack size

GK does NOT cap the closed-tabs array in the renderer reducer. The array grows unbounded over a session. There's a `permanentTabsCacheSize = 100` (bundle:228962) but that's the cap on the REPO_MANAGEMENT tab's repo cache — it doesn't apply here.

In practice, the array doesn't grow without bound because each REPO tab close also drops associated repo state from elsewhere in the store, and a long session that closes thousands of tabs is unusual. **For chajá, follow the same — no cap.** If a user reports memory issues from a 10k-tab session, the fix is upstream (don't keep repo objects in memory for closed tabs).

## Persistence

`closedTabs` is **NOT** in the profile snapshot — `persistTabStateToProfile` (bundle:2373) writes only `{permanentTabs, selectedTabId, tabs}`. The closed-tabs stack lives only in memory and clears on app exit.

**For chajá, follow the same.** The "reopen closed tab" feature is intended for "oops I closed that" within a session, not a persistent history. Persisting would surprise users with an old REPO tab reappearing weeks later when its repo no longer exists at that path.

## Closed-tab payload shape

The full tab record is closed-then-reopened verbatim:

```ts
type ClosedTab = Tab & {
  closedAt: number;        // unix ms — used by ordering
  originalIndex: number;   // position in tabs[] before close — used by REOPEN
};
```

`closedAt` doesn't surface in the dropdown UI (entries are ordered by array position, which IS chronological). It exists for telemetry only — chajá can omit it.

`originalIndex` is consumed by REOPEN to re-insert at the right position. **Don't omit this.** Without it, REOPEN would always append to the end, which surprises users who close a leftmost tab and expect it to come back leftmost.

## Cross-validation

Two claims worth re-grepping:

1. **No cap on closed-tabs array** — confirmed by absence: `grep -nE "closedTabs.*slice|closedTabs.*length\s*>" /tmp/gk-bundle-pretty.js` returns no truncation logic. The reducer at bundle:371175 unconditionally appends.
2. **Closed-tabs not persisted** — confirmed by inspection of `persistTabStateToProfile` body (bundle:2373-2381) — only three fields written. `closedTabs` is absent.
