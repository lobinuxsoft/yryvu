# Section host primitive (`LeftPanelSection` + collapsed-rail variants)

Every section in the LeftPanel — LOCAL, REMOTE, TAGS, the lot — is
mounted by a single host component that GK reuses by passing in a
different `section` prop. The host is responsible for the **header
chrome**, the **scrollable body**, the **expand/collapse animation**,
and the **per-section context-menu hookup**. The *content* of each
row is the section-specific component.

## Host invocation

From the root LeftPanel render (doc 00):

```js
leftPanelSections.map(section =>
  ln.default.createElement(LeftPanelSection, {
    addButtonFns,                  // headerOnClickFns + addButton handlers
    aliases,                       // ref aliases keyed by name
    headerOnClickFns,              // { [HEADER_KEY]: () => toggleExpandedSection(key) }
    isSectionExpandedByKey,        // { [HEADER_KEY]: bool }
    key: section.key,
    onLeftPanelRowClick,           // (event, row, sectionKey) => …
    onLeftPanelSectionContextMenu: // () => popupLeftPanelSectionMenu(false, section.key)
        () => onLeftPanelSectionContextMenu(false, section.key),
    refDispatchProps,              // bag of dispatchers used by row inner components
    refreshButtonFns,              // { [HEADER_KEY]: refreshFn }
    section,                       // { key, headerComponent, headerProps, height, count, rows }
    sectionHeight,                 // px from the resize-handle math
    supportedIssueTrackerTypes,
    toggleFolderShown,
    toggleFolderSoloed,
    toggleStashShown,
    translate,
  }))
```

The host figures out, *from `section.key` alone*:

- Whether to render the section as expanded vs collapsed-into-header
  (driven by `isSectionExpandedByKey[section.key]`).
- Whether to use the regular header or the section's *collapsed*
  header element (`section.collapsedHeaderElement`, used when the
  whole left panel is collapsed to a rail of icons).
- Which add-button / refresh-button dispatch to wire up.
- Which row click and context-menu sagas to invoke.

The chajá equivalent should be the same: one `<LeftPanelSection
section={…}>` component that switches on `section.key` only for the
small bits that genuinely need it (icon, refresh handler), and
delegates everything else to the row's `contentComponent`.

## Section-level state shape (per HEADER_KEY)

Three orthogonal axes, all derived selectors:

```js
getLeftPanelSectionStateByKey = createSelector(
  getIsSectionExpandedByKey,   // user toggled the section header chevron
  getIsSectionInLeftPanelByKey,// (validity AND not in hiddenSections)
  getLeftPanelSectionValidity, // doc 00 — does this feature even apply
  (expanded, inPanel, valid) =>
    Object.keys(valid).filter(k => valid[k]).reduce((acc, k) => ({
      ...acc,
      [k]: !inPanel[k] ? "hidden" : (expanded[k] ? "expanded" : "collapsed")
    }), {}));
```

Three states per section: `"expanded" | "collapsed" | "hidden"`.
`"collapsed"` is the *header-only with a count chip* state — the
body is gone, but the header row still occupies its 30 px.
`"hidden"` is the header is also gone. Don't conflate them.

## Section height math

```js
getLeftPanelSectionHeightLimitsByKey = createSelector(
  getIsSectionExpandedByKey, expanded =>
    ORDERED_LEFT_PANEL_HEADER_KEYS.reduce((acc, k) => {
      const lim = { min: HEADER_HEIGHT };               // 30
      if (expanded[k]) lim.min = HEADER_HEIGHT + SECTION_MINIMUM_HEIGHT;  // 30+108
      else             lim.max = HEADER_HEIGHT;
      return { ...acc, [k]: lim };
    }, {}));
```

So:

- Collapsed section: locked at `min=max=30` px.
- Expanded section: `min=138` px, `max=∞`.

The actual heights come from `getSectionYsByKey` (the cumulative Y
coordinate of every section divider) → `getBoundedSectionYsByKey`
(clamped to the height limits and re-balanced left-to-right) →
`getSectionHeightsByKey` (differences between Ys). Default Y for a
freshly seen section is `previousY + SECTION_DEFAULT_HEIGHT(132) +
HEADER_HEIGHT(30)`.

When the panel shrinks (e.g. window resize), the dividers slide up
together — there's no scrollbar at the *panel* level. Each section
body has its own internal scroll if its content overflows.

## Drag-to-resize between sections

The dividers between expanded sections are draggable. The math
lives in `dragLeftPanelHandle` (saga in `/14834` namespace, also
covered briefly in doc 00):

```js
dragLeftPanelHandle = (Ve, at) => ({ saga: function*(){
    const sections = yield select(getLeftPanelResizableHandleSections),
          height   = yield select(getLeftPanelHeight),
          { bounds } = yield select(getLeftPanelHandleBounds),
          currentY = sections[Ve].y;
    if (Ve < 0 || Ve >= sections.length || Math.abs(at - currentY) < .001) return;
    const newY = clamp(bounds[Ve].minY, bounds[Ve].maxY, at);
    if (Math.abs(newY - currentY) < .001) return;
    const Ys = sections.reduce((acc, s) => ({ ...acc, [s.id]: s.y }), {});
    Ys[sections[Ve].id] = newY;
    // cascade: when handle Ve moves down, push handles below; when up, pull handles above
    const direction = newY > currentY ? DOWN : UP;
    const clampFn   = LEFT_PANEL_MATH_CLAMP_FNS[direction];   // Math.max for DOWN, Math.min for UP
    let cursor = newY;
    for (let i = Ve + direction; indexInBounds(i); i += direction) {
      const offset = direction === DOWN
                    ? sections[i].min
                    : sections[i + 1].min;
      cursor = clampFn(sections[i].y, cursor + offset * direction);
      if (cursor === sections[i].y) break;
      cursor = clamp(bounds[i].minY, bounds[i].maxY, cursor);
      Ys[sections[i].id] = cursor;
    }
    // mirror for the opposite direction (push max constraints back)
    yield put(LeftPanelSectionYsByKeyUpdated(repoPath, Ys));
}});
```

On drag-end:

```js
onLeftPanelSectionResizeEnd = () => ({ saga: function*(){
    const Ys = yield select(getSectionYsByKey),
          repoPath = yield select(getRepoPath);
    yield put(setRepoSetting(["layout","leftPanel","sectionYsByKey"], Ys, repoPath));
    yield put(LeftPanelIsHandleDraggingUpdated(false));
}});
```

`bounds.fixed` (a flag in `getLeftPanelHandleBounds`) goes true when
the sum of all `min` heights >= the available container height — at
that point dragging is impossible and the panel switches to a
**single overflow scrollbar** for the whole stack. That's why
chajá's "fits / doesn't fit" branch is `!bounds.fixed ? <DragHandles…> : null`
in the root render.

## Header chrome (per-section)

Each section's `headerComponent` (e.g. `LocalHeader`, `RemoteHeader`,
`PullRequestHeader`) is built with a roughly-shared template:

```js
<SectionHeader>
  <ChevronToggle isExpanded={isExpanded} onClick={headerOnClickFns[KEY]} />
  <Icon for={KEY} />
  <Label>{translate(`LeftPanel-${KEY}Label`)}</Label>
  <Count title={countDenominator > countNumerator ? `${countNumerator} of ${countDenominator}` : countNumerator}>
    {isFiltering && countDenominator !== countNumerator
      ? `${countNumerator}/${countDenominator}`
      : count}
  </Count>
  {/* Section-specific extras: */}
  {hasAddButton  && <AddButton  disabled={addButtonDisabled} title={addButtonToolTip} onClick={…} />}
  {hasRefreshBtn && <RefreshButton spinning={fetchStatus === IN_PROGRESS} onClick={refreshButtonFns[KEY]} />}
  {/* Right-click → popupLeftPanelSectionMenu (per-section "hide all / maximize / toggle other sections" menu — see doc 10) */}
</SectionHeader>
```

The "extras" surface (which buttons each section gets) is
section-specific:

| Section | Add | Refresh | Per-section search |
|---------|-----|---------|--------------------|
| GITFLOW | + (open Git Flow init dialog) | — | — |
| LOCAL | — | — | — |
| REMOTE | — | refresh per remote (in body, not header) | — |
| WORKTREES | + (create worktree) | — | — |
| STASHES | — | — | — |
| CLOUD_PATCHES | + (create patch) | refresh | — |
| PULL_REQUESTS | — | refresh | yes — `PullRequestFilterSlideyPanel` |
| ISSUES | — | refresh | yes — `IssueTrackerSearch` |
| TEAM_VISIBILITY | — | refresh | — |
| TAGS | — | — | — |
| SUBMODULES | + (init submodule) | — | — |

## Collapsed-rail (whole panel collapsed)

When `getIsLeftPanelCollapsed` is true, the root render replaces
`<Resizable>…<sections>…</Resizable>` with a `<LeftPanelCollapsed>`
component that renders **a vertical rail of icons** — one icon per
visible section, tagged with its count:

```js
const CollapsedHeader = ({count, defaultClasses="", iconElement}) => {
  const hasCount = count !== undefined;
  return (
    <div className={cx("flex flex-column justify-center pointer height-100-percent",
                       defaultClasses)}>
      {iconElement}
      {hasCount && <div className="count center px1 fs-1 text-accent truncate" title={count}>
        {count}
      </div>}
    </div>);
};

CollapsedLocalHeader      = p => <CollapsedHeader {...p} iconElement={<CollapsedLocalHeaderIcon/>}/>;
CollapsedRemoteHeader     = p => {
  const warning = p.anyRemoteSilentFetchFailed && p.translate?.("RefBar-SilentFetchFailed");
  return <CollapsedHeader {...p} iconElement={<CollapsedRemoteHeaderIcon showWarningText={warning}/>}/>;
};
CollapsedTagHeader        = p => <CollapsedHeader {...p} iconElement={<CollapsedTagHeaderIcon/>}/>;
CollapsedStashHeader      = p => <CollapsedHeader {...p} iconElement={<CollapsedStashHeaderIcon/>}/>;
CollapsedPullRequestHeader= p => <CollapsedHeader {...p} iconElement={<CollapsedPullRequestHeaderIcon/>}/>;
CollapsedGitFlowHeader    = p => <CollapsedHeader {...p}
                                        defaultClasses={`gitflow ${p.defaultClasses??""}`}
                                        iconElement={<CollapsedGitFlowHeaderIcon/>}/>;
CollapsedSubmoduleHeader  = p => <CollapsedHeader {...p} iconElement={<CollapsedSubmoduleHeaderIcon/>}/>;
CollapsedWorktreeHeader   = p => <CollapsedHeader {...p} iconElement={<CollapsedWorktreeHeaderIcon/>}/>;
CollapsedTeamVisibilityHeader = p => <CollapsedHeader {...p} iconElement={<CollapsedTeamVisibilityHeaderIcon/>}/>;
CollapsedCloudPatchesHeader   = p => <CollapsedHeader {...p} iconElement={<CollapsedCloudPatchesHeaderIcon/>}/>;
CollapsedIssueTrackerSettingsHeader = p => <CollapsedHeader {...p} iconElement={<CollapsedIssueTrackerSettingsHeaderIcon/>}/>;
CollapsedGitHubIssuesHeader   = p => <CollapsedHeader {...p} iconElement={<CollapsedGitHubIssuesHeaderIcon/>}/>;
CollapsedJiraHeader           = p => <CollapsedHeader {...p} iconElement={<CollapsedJiraHeaderIcon/>}/>;
CollapsedGitLabHeader         = p => <CollapsedHeader {...p} iconElement={<CollapsedGitLabHeaderIcon/>}/>;
CollapsedTrelloHeader         = p => <CollapsedHeader {...p} iconElement={<CollapsedTrelloHeaderIcon/>}/>;
```

Two non-obvious things:

- `CollapsedRemoteHeader` shows a *warning glyph* on its icon when
  any remote silently failed a fetch (the regular header would show a
  red banner; the collapsed rail only has room for an icon
  decoration).
- `CollapsedGitFlowHeader` carries a `gitflow` class so the gitflow
  icon styling kicks in. Special-cased on purpose.

## chajá implementation hint

- One `<LeftPanelSection>` component; switch on `section.key` only
  for the section-specific *button surface* (add, refresh) and
  *icon*. Everything else flows through props.
- Use the same three-state model (`hidden | collapsed | expanded`).
  Don't conflate "collapsed" with "hidden" — they have different UX
  consequences (collapsed still shows a count chip; hidden is gone).
- Persist the per-section Y positions per-repo, not per-profile.
  Different repos legitimately need different section sizes (a repo
  with 200 branches and 0 stashes vs the inverse).
- The whole-panel collapsed rail is a separate component
  (`LeftPanelCollapsed` in GK). Mirror this — don't try to share
  code with the expanded host. The collapsed rail has different
  semantics (icon + count, no body, click-to-expand, no drag).
