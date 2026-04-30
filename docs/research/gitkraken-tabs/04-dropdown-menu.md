# Dropdown Menu

The chevron `⌄` next to the `+` button toggles a dropdown menu showing both **Open Tabs** and **Closed Recently** in a single searchable list. Implementation uses `react-select` (bundle:375697) with two option groups — chajá's port can use a Solid-native combobox or roll a simple filtered list.

## Toggle saga (bundle:2495-2511)

```js
at.toggleTabDropdown = () => ({
    saga: function* ToggleTabDropdownSaga(Ve) {
        switch (yield(0, mn.select)(Ga.getCurrentModal)) {
            case void 0:
            case null:
                break;
            case xa.modals.ABOUT:
            case xa.modals.ACTIVITY_LOG:
            case xa.modals.CREATE_FILE:
            case xa.modals.FUZZY_FINDER:
                yield Ve.call(Ba.closeModal);
                break;
            default:
                return
        }
        yield(0, mn.put)((0, ja.ToggleTabDropdownMenu)())
    }
});
```

Two non-obvious things:

1. **Modal pre-flight**: only the four named modals (`ABOUT`, `ACTIVITY_LOG`, `CREATE_FILE`, `FUZZY_FINDER`) get auto-closed before the dropdown opens. **Any other modal causes `toggleTabDropdown` to silently return without opening the menu** (`default: return`). The user has to dismiss those modals manually first. Port the four-case allowlist verbatim — picking arbitrary modals to close would surprise users who explicitly opened a non-allowlisted modal.

2. **`ToggleTabDropdownMenu` is a plain action**, not a state setter — it flips `state.ui.tabs.isTabDropdownOpen` (reducer at bundle:309860). The component reads that signal to render `menuIsOpen`.

## Component (bundle:375667-375735)

The dropdown menu is `react-select` rendered with `menuIsOpen: !0` (always-open while the chevron is toggled). Uses two option groups:

```js
const dn = [{
    label: "Open Tabs",
    options: lodash.map((at => getItemFromTab(at, dt, Ve, handleCloseTab(at.id))), ct)
}, {
    label: "Closed Recently",
    options: lodash.map((at => getItemFromTab(at, dt, Ve)), at)
}];
```

The single `_onClick` handler (bundle:375667) checks whether the clicked item is in `reopenableTabs` — if yes, calls `reopenTab`; if no, calls `selectTab`. This is the trick: **a single combobox routes to two different ops based on which group the row came from**. Port the same dispatcher rather than wiring two parallel lists.

## Items (bundle:375620-375665)

Each row carries `{id, type, icon, title, closeTab?}`. Title comes from i18n key (chajá ports as plain strings):

| `tab.type` | Title source | Icon |
|---|---|---|
| `REPO` | `getAliasFromTab(tab, aliases) || tab.repoName` | gkGUI product icon |
| `NEW` | `"New Tab"` (`TabsBar-NewTabTitle`) | none |
| `RELEASE_NOTES` | `"Release Notes"` (`TabsBar-ReleaseNotesTitle`) | FontAwesome `fas clipboard-list` |
| `REPO_MANAGEMENT` | (handled outside this list) | — |
| `CLI` | (skip) | — |
| `FOCUS_VIEW` | (skip) | — |

For "Closed Recently" rows, the `closeTab` callback is omitted (you can't close a closed tab) — just the title + icon, click → `reopenTab`.

## Selectors

| Selector | Purpose | Location |
|---|---|---|
| `getReopenableTabs` | Closed tabs filtered by user features (some tab types can't be reopened depending on tier) | bundle:372932 |
| `getCanReopenTabs` | Boolean: "is the closed-tabs stack non-empty?" | bundle:~372930 |
| `getMostRecentlyClosed` | `lodash.last(closedTabs)` | bundle:372930 |

For chajá, **drop the user-features filter** — there's no tiering. `getReopenableTabs` becomes `closedTabs()` directly.

## Keyboard interaction

- **Type to filter**: react-select's input field auto-focuses on mount (`componentDidMount → reactSelect.focus()` at bundle:375658). Filter works on the row title via `lodash.find(query, get(['data','title'], opt))`.
- **Escape**: `_onInputKeyDown` (bundle:375672) — closes the menu via `closeMenu()` (which dispatches `SetIsTabDropdownOpen(false)`).
- **Enter**: standard react-select behavior — selects highlighted row.
- **Arrow keys**: standard react-select behavior — navigates between rows across both groups.

For the chajá port, use Solid's native list rendering with a controlled input. Match the flow:

```ts
const [query, setQuery] = createSignal("");
const filtered = createMemo(() => {
  const q = query().toLowerCase();
  return {
    open:   tabs().filter(t => titleOf(t).toLowerCase().includes(q)),
    closed: closedTabs().filter(t => titleOf(t).toLowerCase().includes(q)),
  };
});
```

## Auto-close triggers

The dropdown closes itself on several events (reducer handlers at bundle:309860+):

- `ModalOpened` — any modal opening dismisses the dropdown.
- `PreferenceViewOpened` — opening the Preferences window dismisses it.
- `ReviewModeStarted` — opening the review mode dismisses it.
- Explicit `SetIsTabDropdownOpen(false)` — fired by `closeMenu`, by Escape, by selecting a row, by reopening a tab.

For chajá, port the first two and the explicit close. Review mode is out of scope (proprietary).

## Cross-validation

Three claims worth re-grepping:

1. **Modal allowlist is closed at exactly 4 entries** — confirmed at bundle:2500-2509. The `default: return` branch means non-allowlisted modals block the dropdown silently. Don't extend the allowlist without product input.
2. **Single dispatcher for both groups** — confirmed at bundle:375667. The "is this in `reopenableTabs`?" check decides between `reopenTab` and `selectTab`. Two separate lists with two separate handlers would be a regression.
3. **Always-open `menuIsOpen: !0`** — confirmed at bundle:~375707. The dropdown is not a click-to-open combobox; it's permanently open while the chevron toggle is `true`. The chevron click handler controls both visibility and focus return.
