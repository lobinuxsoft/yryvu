# Global filter input + sidebar header

The single text input at the top of the LeftPanel is *the* filter
for the whole panel. It applies to every section in
`ORDERED_LEFT_PANEL_HEADER_KEYS` *except* the two listed in
`UNFILTERABLE_SECTION_KEYS = { PULL_REQUESTS, ISSUES }`. PRs and
Issues have their own search widgets inside their section bodies
(see docs 08 and 09).

## Component

```js
<LeftPanelFilterInput
   clearQueryFn       = {dt(repoPath)}
   filterValue        = {filterValue}
   isFilterFocused    = {isFilterFocused}
   isFiltering        = {isFiltering}
   isSoloing          = {isSoloing}
   isViewing          = {!isSoloing && !isFiltering}
   label              = {leftPanelStatusHeaderLabel}   // "Viewing X branches" / "Filtering" / "Soloing"
   onContextMenu      = {onFilterContextMenu}
   onFilterBlur       = {onFilterBlur}
   onFilterFocus      = {onFilterFocus}
   onQueryChange      = {makeOnQueryChange(repoPath)}
   refCountDenominator= {size(refs)}
   refCountNumerator  = {isFiltering ? unfilteredCount : totalRefsShown}
   resetFn            = {…}                            // see "Reset behaviour"
   resetLabel         = {leftPanelResetLabel}
   showCollapseButton = {!showLeftPanelWorkflowView}
   togglePanelFn      = {togglePanelFn}
   translate          = {translate} />
```

The two ratio numbers (`numerator/denominator`) are the source of
the "n / N" pill that appears when the filter narrows the visible
ref set. When not filtering, only the total is shown.

## Wiring

```js
makeOnQueryChange: at => ct => {
  Ve(LeftPanelFilterValueUpdated(ct.target.value));     // immediate (UI reflects keystroke)
  Ve(debouncedSetLeftPanelQuery(at, ct.target.value.trim()));   // debounced 250 ms
}

debouncedSetLeftPanelQuery = debouncedGenerator(function*(repoPath, value){
  yield put(setRepoSetting("leftPanelQuery", value, repoPath));
}, 250);
```

So GK *separates* the two concerns:

- **`leftPanel.filterValue`** (redux UI) — updated synchronously on
  every keystroke. Drives the visible *value* of the input.
- **`repoSettings.leftPanelQuery`** (per-repo persisted) — updated
  250 ms after the last keystroke. Drives the *actual filtering*
  selectors and is what gets persisted to disk.

That's the right split. It means the filter survives repo switches
(per-repo persistence) but doesn't write to disk on every keystroke,
and it means the input feels instant even though filtering is
debounced.

## Reset behaviour

```js
resetFn: () => {
  isSoloing
    ? (smartBranchesEnabled ? disableSmartBranchesVisibility() : unsoloAll())
    : (isEmpty(filterValue) ? showAll() : clearQueryFn());
}
```

Decision tree:

- **If you're soloing branches** (LOCAL section "solo this branch"
  feature): the reset clears soloing. If smart-branches is on, it
  calls a different service to disable it (see doc 04 for the
  smart-branches FLAG).
- **Else if there's no filter typed**: the reset is "Show all"
  (re-show every hidden ref / remote / stash / tag in the visible
  sections — equivalent to the per-section "Show all" multiplied
  across all four).
- **Else**: clear the filter input.

The label of the reset button changes to match (`leftPanelResetLabel`):

```js
getLeftPanelResetLabel = (isSoloing, isFiltering, smartBranchesEnabled) => {
  if (isSoloing) return smartBranchesEnabled
    ? "RefBar-DisableSmartBranches"
    : "RefBar-StopSoloing";
  if (isFiltering) return "RefBar-ClearFilter";
  return "RefBar-ShowAll";
};
```

## Status header label (above the filter input)

```js
getLeftPanelStatusHeaderLabel = (isSoloing, isFiltering, smartBranchesEnabled) => {
  if (isSoloing)   return smartBranchesEnabled
                          ? "RefBar-StatusSmartBranches"
                          : "RefBar-StatusSoloing";
  if (isFiltering) return "RefBar-StatusFiltering";
  return "RefBar-StatusViewing";
};
```

A label sits *above* the input ("Viewing", "Filtering",
"Soloing") to make the panel's current mode unambiguous. Three
states, mutually exclusive.

## Focus tracking

```js
onFilterBlur:  () => Ve(UiValueChanged("isLeftPanelFilterFocused", false)),
onFilterFocus: () => Ve(UiValueChanged("isLeftPanelFilterFocused", true)),
```

`getIsLeftPanelFilterFocused` is its own selector, used by:

- The graph: to dim the "current selection" outline so the filter
  input feels like the active focus target.
- Keyboard handlers: certain global shortcuts (e.g. arrow-key
  branch traversal) are gated off when the filter is focused, so
  arrow keys feed the input rather than navigating.

## Right-click on the input

```js
onFilterContextMenu: () => Ve(NextMenuPromiseUpdated(Promise.resolve())),
```

Suppresses the native context menu (no Cut/Copy/Paste). Clicking
right-button on the filter input does **nothing** in GK. Probably
deliberate: the panel-wide right-click target sits on the section
headers / rows themselves, and they didn't want the input to compete.

This is a deviation from typical text-input ergonomics. Chajá can
choose to keep the native menu or follow GK; flagging it.

## Per-section search widgets (PRs and Issues)

Because `UNFILTERABLE_SECTION_KEYS = { PULL_REQUESTS, ISSUES }`,
those two sections ignore the global filter and instead inject a
search widget as a row inside their body:

```js
// PR section, prepended row
{ contentComponent: PullRequestSearchInput,           // see doc 08
  height:           PULL_REQUEST_SEARCH_HEIGHT,       // 35
  props: { canBeHidden: false, key: "PULL-REQUEST-SEARCH" } }

// Issues section, prepended row when settings form not shown
{ contentComponent: IssueTrackerSearchInput,          // see doc 09
  height:           ISSUE_TRACKER_SEARCH_HEIGHT,      // 35
  props: { isLeftPanel: true, key: "ISSUE-TRACKER-SEARCH" } }
```

These rows are non-hideable (`canBeHidden: false`) and pinned at
the top of the section — they scroll with the section body, not
with the panel.

## chajá implementation hint

- Implement the global filter as one `<LeftPanelFilter>` component
  with the *same* split: in-memory `signal` for the input value,
  debounced (250 ms) write to the per-repo persisted `leftPanelQuery`
  setting. Don't merge the two — `createMemo` over a debounced
  signal will make the input lag.
- Build the three-mode label (Viewing / Filtering / Soloing) into
  the input chrome. Don't try to derive it ad-hoc inside each
  section — it lives at the top because the user reads "what mode
  am I in" *before* scanning the section bodies.
- Suppress the native context menu only after the user objects to
  having it — losing Paste on a search input is hostile. GK gets
  away with it because it's GK; chajá can keep the native menu.
- PR and Issue sections need their *own* in-section search rows.
  Don't try to make the global filter narrow PRs/Issues — their
  filter syntax is different (provider query DSL vs ref-name
  fuzzy-match) and would mean confusing semantics.
