# Tab Bar Chrome

The tab bar is a `connect`-wrapped React component (bundle:330200-330470). It owns the tab strip, the `+` button, the dropdown chevron, the activity menu, the notifications menu, and the profile menu — but for the port we only care about the first three.

## Container `connect` shape (bundle:330240-330295)

The `mapDispatch` half registers all tab-related callbacks. The relevant ones:

```js
hoverTab: at => Ve(handleTabHovered(at)),
unhoverTab: () => Ve(handleTabUnhovered()),
selectTab: at => Ve(performTabOperation({ type: tabOperationTypes.SWITCH_TO, tabId: at })),
openNewTab: () => Ve(openNewTab()),
onSortStart: () => Ve(IsTabBeingDraggedUpdated(!0)),
onSortEnd: ({ oldIndex: at, newIndex: ct }) => {
    Ve(IsTabBeingDraggedUpdated(!1)),
    Ve(performTabOperation({ type: tabOperationTypes.MOVE, oldIndex: at, newIndex: ct }))
},
setIsTabDropdownOpen: at => Ve(SetIsTabDropdownOpen(at)),
tabContextMenu: at => Ve(popupTabMenu({
    tabId: at,
    performTabOperation,
    tabOperationTypes
})),
```

For chajá, drop the `connect` boilerplate — Solid components import the signals + ops directly. The handlers above become local callbacks.

## Tab strip layout

GK uses **react-sortable-list** as the strip container (HOC at bundle:120658+, applied to the strip at bundle:330230). The list:

- Renders one item per `tabs[i]` plus a sentinel item for the dropdown chevron.
- Wraps each tab pill in a sortable handle (entire pill is the drag affordance).
- Exposes `axis: "x"`, `lockAxis: "x"`, `useDragHandle: false`.

For chajá's port, the equivalent is **a flexbox row** (`display: flex; flex-direction: row`) with tab pills as children. Drag-reorder is sub-PR 8 (= **#39**); for sub-PR 2 just render static pills, no drag.

## Tab pill

Each pill is a single element with three click targets:

| Region | Action | Notes |
|---|---|---|
| Pill body | `selectTab(tabId)` | dispatches `SWITCH_TO` |
| Right-click anywhere on pill | `tabContextMenu(tabId)` | shows context menu (close, close others, close all to right, etc.) |
| Close `×` (right edge, hover-only) | `closeTab(tabId)` → `performTabOperation({type: CLOSE, tabId})` | doesn't surface unless tab is hovered |

Tooltip on hover: shows the full title after `TAB_TOOLTIP_HOVER_MS = 600ms` of dwell, hides after `TAB_TOOLTIP_RESET_MS = 300ms` post-leave. Tooltip width clamped to `TAB_TOOLTIP_WIDTH = 250px`. **Only fires if the title is truncated** — full-width titles get no tooltip (avoids tooltip noise on narrow tab bars).

Visual states (CSS classes):

| State | Class |
|---|---|
| Active (selected) | `is-active` |
| Hover | `is-hover` |
| Drag in progress | `is-being-dragged` (set on the pill being dragged) |
| Other tabs while drag in progress | `is-sibling-dragging` (suppresses hover/click cursors) |
| New unsaved indicator | `is-dirty` (used for in-progress commits — out of scope for v1) |

## `+` button

Element ID: `NEW_TAB_BUTTON_ID = "new-tab-button"` (bundle:228929) — port verbatim, the dropdown menu uses this ID for keyboard focus management.

```jsx
<button
  id="new-tab-button"
  class="tab-bar__new-button"
  aria-label="New tab"
  onClick={() => openNewTab()}>
  <Icon name="plus" size={14} />
</button>
```

Position: immediately to the right of the last tab pill, **inside** the sortable list as a fixed (non-sortable) trailing item. This prevents the user from dragging a tab past the `+` button — ports cleanly with `flex` + the button as the last flex child.

## Dropdown chevron

Right of the `+` button. Single click toggles the dropdown menu (see `04-dropdown-menu.md`):

```jsx
<button
  class="tab-bar__dropdown-chevron"
  aria-label="Tab menu"
  aria-expanded={isTabDropdownOpen()}
  onClick={() => toggleTabDropdown()}>
  <Icon name="chevron-down" size={12} />
</button>
```

Note that the chevron handler is `toggleTabDropdown()` (the saga at bundle:2495), **not** `setIsTabDropdownOpen(true)`. The saga performs the modal-pre-flight (close ABOUT/ACTIVITY_LOG/CREATE_FILE/FUZZY_FINDER first, see doc 04) before the menu opens — bypassing it surfaces the menu under the modal.

## Container layout

Confirmed by inspection of the strip JSX at `bundle:330605-330614`:

```
[REPO_MGMT][FOCUS_VIEW][ tab1 ][ tab2 ][ tab3 ][ + ]   ▏(spacer)▏   [⌄][notifs][prefs][activity][profile]
└── permanent ──┘└──── sortable transient strip ────┘                 └────── right-side menus ──────┘
```

The actual JSX structure is:

```js
createElement("div", { className: "flex flex-row justify-between height-100-percent" },
  createElement("div", { className: "tabs-bar" },
    Ti,                                           // REPO_MANAGEMENT permanent pill (leftmost)
    createElement("div", { className: "flex items-center ..." },
      Oi,                                         // FOCUS_VIEW permanent pill
      createElement(SortableStrip, null, Xo),     // transient tabs (sortable list)
      _i                                          // + button + tooltip
    ),
    ss                                            // right-side: chevron, notifs, prefs, activity, profile
  )
);
```

**Permanent tabs render LEFT of the transient strip**, not at the right edge. `Ti` (REPO_MANAGEMENT) comes first, then `Oi` (FOCUS_VIEW conditional), then the sortable list of transient tabs, then the `+` button.

In chajá's port the right-side menus are out of scope for #135 (notifications already exists in `Toolbar/`, profile is part of #22, activity is GK-internal). Just ship: REPO_MANAGEMENT pill (when un-closed) + transient strip + `+` button + dropdown chevron.

## Drag-reorder details

Defer to `10-drag-reorder.md`. Sub-PR 2 renders pills with no drag affordance; sub-PR 8 (#39) layers it on with `react-sortable-list` or a Solid-native equivalent.

## Cross-validation

Two surprising claims:

1. **`NEW_TAB_BUTTON_ID = "new-tab-button"` is referenced by the dropdown for focus return** — confirmed at bundle:228929. The dropdown menu's keyboard nav restores focus to this ID on close. Port the literal string, don't camelCase it or prefix it.
2. **The `+` button lives INSIDE the sortable container** — confirmed at bundle:330200+ where the new-tab button is a sibling of the tab items in the sortable list, not a separate flex child outside it. This prevents drag-past-end. The Solid port can simulate this by placing the button as the last child of the same flex row.
3. **Permanent tabs render LEFT of transient tabs** — confirmed at bundle:330605-330614. `Ti` (REPO_MANAGEMENT) is the first child of `tabs-bar`, then a nested flex containing `Oi` (FOCUS_VIEW), the sortable strip, and the `+` button. An earlier draft of this doc placed permanent tabs at the right edge — that was wrong.
