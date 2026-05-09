# Tab Types and Store Shape

## Tab type enum (bundle:228930-228943)

The exported `tabTypes` is the union of two disjoint sets — `transientTabTypes` (created/destroyed by user actions) and `permanentTabTypes` (singletons that exist forever, only their `closed` flag flips):

```js
const ct = at.transientTabTypes = {
        NEW: "NEW",
        REPO: "REPO",
        RELEASE_NOTES: "RELEASE_NOTES",
        CLI: "CLI"
    },
    dt = at.permanentTabTypes = {
        FOCUS_VIEW: "FOCUS_VIEW",
        REPO_MANAGEMENT: "REPO_MANAGEMENT"
    },
    ln = at.tabTypes = { ...ct, ...dt };
at.permanentTabIds = dt;
```

**For yryvu** — port 4 of 6:

| Type | Source group | Port? | Notes |
|---|---|---|---|
| `REPO` | transient | ✅ | already shipped |
| `NEW` | transient | ✅ | sub-PR 3 |
| `RELEASE_NOTES` | transient | ✅ | sub-PR 6 |
| `REPO_MANAGEMENT` | permanent | ✅ | sub-PR 7 |
| `CLI` | transient | ❌ | no terminal in yryvu (#25 deferred) |
| `FOCUS_VIEW` | permanent | ❌ | GK Launchpad proprietary |

Notice that `permanentTabIds === permanentTabTypes` — the bundle reuses the type-string as the singleton ID. Don't invent fresh UUIDs for the two permanent tabs.

## Operation type enum (bundle:228944-228957)

Every state mutation flows as one of these 13 operation types:

```js
at.tabOperationTypes = {
    BULK_CLOSE, BULK_CREATE, CLOSE, CREATE,
    LOAD_TABS, MOVE, MUTATE,
    REOPEN, REOPEN_LAST_CLOSED,
    SWITCH_TO, SWITCH_TO_INDEX, SWITCH_TO_NEXT, SWITCH_TO_PREVIOUS
};
```

**`MUTATE` is the only non-obvious one** — used to convert an existing tab in-place, e.g. `replaceSelectedTabWithNewTab` (bundle:2579) flips a REPO tab into a NEW tab without losing its `tabId` or its position in the strip. Without `MUTATE`, the user would see the active pill flicker out and reappear at the end.

## Channel work states (bundle:228958-228961)

```js
at.channelWorkStates = {
    NOT_RUNNING: "NOT_RUNNING",
    TAB_CHANGE: "TAB_CHANGE",
    AFTER_OPERATION_CB: "AFTER_OPERATION_CB"
};
```

These flag the dispatcher's queue state — see `02-tab-ops-api.md` for how `consumeTabOperations` cycles between them. UI components wait on `NOT_RUNNING` before dispatching new ops.

## Misc constants (bundle:228929, 228962)

```js
at.NEW_TAB_BUTTON_ID = "new-tab-button";
at.TAB_TOOLTIP_HOVER_MS = 600;
at.TAB_TOOLTIP_RESET_MS = 300;
at.TAB_TOOLTIP_WIDTH = 250;
at.permanentTabsCacheSize = 100;
at.tabTypesThatCanHaveATerminal = [tabTypes.REPO];  // skip
at.tabsIpcMessageChannels = { OPEN_REPO_MANAGEMENT_TAB: "OPEN_REPO_MANAGEMENT_TAB" };
```

Port `NEW_TAB_BUTTON_ID` and the three `TAB_TOOLTIP_*` constants verbatim — they govern hover-tooltip timing on truncated tab labels (a UX detail GK handles per pixel). `permanentTabsCacheSize` caps the number of repos REPO_MANAGEMENT tab remembers, not the closed-tabs stack. `tabsIpcMessageChannels` belongs to GK's main↔renderer IPC; yryvu's Tauri-IPC layer doesn't need a parallel.

## Store shape

The redux store slice `state.tabs` (Immutable.js Map at runtime, but treat as plain object for the port) holds:

```ts
interface TabsSlice {
  tabs: Tab[];                          // ordered list of transient tabs
  selectedTabId: string;                // UUID of active tab (transient or permanent)
  permanentTabs: {
    FOCUS_VIEW?: { closed: boolean };   // omit
    REPO_MANAGEMENT?: { closed: boolean };
  };
  closedTabs: ClosedTab[];              // LIFO stack — see doc 06
  // ... drag flag
  isTabBeingDragged: boolean;
}

interface Tab {
  id: string;                           // UUID (or permanentTabId for permanent tabs)
  type: TabType;                        // one of tabTypes values
  repoPath?: string;                    // REPO only
  isWorktree?: boolean;                 // REPO only — distinguishes worktree from main checkout
  version?: string;                     // RELEASE_NOTES only — see doc 08
}
```

Selectors live near `bundle:372861`. The yryvu port uses Solid signals + derived `createMemo` instead, but the keys map 1:1:

| GK selector | yryvu signal name |
|---|---|
| `Ma.getTabs` | `tabs` |
| `Ma.getSelectedTabId` | `selectedTabId` |
| `Ma.getCurrentTab` | `currentTab` (memo: `tabs().find(t => t.id === selectedTabId())`) |
| `Ma.getCurrentTabType` | `currentTabType` (memo: `currentTab()?.type`) |
| `Ma.getPermanentTabs` | `permanentTabs` |
| `Ma.getClosedTabs` | `closedTabs` |
| (custom) `getCanReopenTabs` | `canReopen` (memo: `closedTabs().length > 0`) |
| (custom) `getMostRecentlyClosed` | `mostRecentlyClosed` (memo: `closedTabs().at(-1)`) |

## Persistence (bundle:2373-2381)

```js
const persistTabStateToProfile = () => ({
    saga: function* persistTabStateToProfileSaga(Ve) {
        const at = yield(0, mn.select)(Ma.getTabs),
              ct = yield(0, mn.select)(Ma.getSelectedTabId),
              dt = yield(0, mn.select)(Ma.getPermanentTabs),
              ln = (0, Aa.makeProfilePermanentTabs)(dt);
        yield Ve.call(ur.setCurrentProfileSetting, ["tabInfo"], {
            permanentTabs: ln,
            selectedTabId: ct,
            tabs: at
        })
    }
});
```

Persisted under profile key `tabInfo` with three fields: `permanentTabs`, `selectedTabId`, `tabs`. `closedTabs` is **not** persisted to profile in the snapshot path — it's reconstructed from in-memory state and discarded on app exit.

**For yryvu**:
- Persist to `~/.config/com.lobinuxsoft.yryvu/preferences.json` under a new `tabs` key (separate from the existing `general` / `ui` sections in `preferences.rs`). Reuse the atomic-write sidecar pattern.
- Bump `preferences.rs` `SCHEMA_VERSION` if you add this section. New optional fields with `#[serde(default)]` don't require a bump, but a fresh `tabs` envelope at the top level does — to match the load-time transform contract.
- `closedTabs` stays in-memory only (matches GK).

## Cross-validation

Three claims worth re-grepping before coding:

1. **`permanentTabIds === permanentTabTypes`** — confirmed at `bundle:228940` (`at.permanentTabIds = dt` where `dt` is the same object literal exported as `permanentTabTypes`).
2. **`tabTypesThatCanHaveATerminal = [REPO]`** — only REPO tabs host the embedded terminal pane. Yryvu skips this regardless.
3. **`MUTATE` preserves `tabId`** — confirmed in `replaceSelectedTabWithNewTab` (bundle:2588): the existing `selectedTabId` is reused as the `tabId` field in the MUTATE op, which means the React reconciler keeps the same DOM node. Without this, `replaceSelectedTabWithNewTab` would force a remount.
