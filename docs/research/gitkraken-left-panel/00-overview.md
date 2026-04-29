# LeftPanel — top-level architecture

GitKraken's LeftPanel is a *vertical stack of self-contained sections*
that all live behind one filter, one resize/visibility model, and one
context-menu builder. Every section is just an entry in a constant
table — adding a new section is one entry in the dispatch table plus
the seven selectors per section that table expects.

## The header-key constants (single source of truth)

Inside the bundle, every section is referenced by a string constant:

```js
const ct=at.CLOUD_PATCHES   ="CLOUD_PATCHES",
      dt=at.GITFLOW         ="GITFLOW",
      ln=at.ISSUES          ="ISSUES",
      dn=at.LOCAL           ="LOCAL",
      hn=at.PULL_REQUESTS   ="PULL_REQUESTS",
      mn=at.REMOTE          ="REMOTE",
      gn=at.STASHES         ="STASHES",
      Rn=at.SUBMODULES      ="SUBMODULES",
      An=at.TAGS            ="TAGS",
      Dn=at.TEAM_VISIBILITY ="TEAM_VISIBILITY",
      Fn=at.WORKTREES       ="WORKTREES";

at.ORDERED_LEFT_PANEL_HEADER_KEYS = [
  dt /*GITFLOW*/, dn /*LOCAL*/, mn /*REMOTE*/,
  Fn /*WORKTREES*/, gn /*STASHES*/, ct /*CLOUD_PATCHES*/,
  hn /*PULL_REQUESTS*/, ln /*ISSUES*/,
  Dn /*TEAM_VISIBILITY*/, An /*TAGS*/, Rn /*SUBMODULES*/
];

at.HEADER_KEYS               = { CLOUD_PATCHES:ct, GITFLOW:dt, ... };
at.UNFILTERABLE_SECTION_KEYS = { PULL_REQUESTS:hn, ISSUES:ln };

at.REF_HEIGHT             = 24;
at.HEADER_HEIGHT          = 30;
at.SECTION_DEFAULT_HEIGHT = 132;
at.SECTION_MINIMUM_HEIGHT = 108;
at.VERTICAL_SCROLLBAR_WIDTH = 8;
```

Notes the chajá team should internalise:

- The render order is **not** alphabetical and **not** the same as
  `HEADER_KEYS`. It's its own list. Match it byte-for-byte for visual
  parity.
- Two sections (`PULL_REQUESTS`, `ISSUES`) opt out of the global
  filter via `UNFILTERABLE_SECTION_KEYS` — they have their own search
  widget instead. See doc 02.
- All ref rows are 24 px high. All section headers are 30 px high.
  The default newly-shown section gets 132 px of body, never less than
  108 px. Use these exact numbers for 1:1 feel.

## The dispatch table

`getLeftPanelSections` maps every header key through a per-section
factory selector that returns either a `{ key, headerComponent,
headerProps, height, count, rows, ... }` object or `null`:

```js
const Ur = {
  [hn.CLOUD_PATCHES]:   makeCloudPatchesSection,   // ❌ proprietary
  [hn.GITFLOW]:         <gitflow factory>,         // ✅ pure git
  [hn.ISSUES]:          <issues factory>,          // ✅ provider API
  [hn.LOCAL]:           <local factory>,           // ✅ pure git
  [hn.PULL_REQUESTS]:   <pr factory>,              // ✅ provider API
  [hn.REMOTE]:          <remote factory>,          // ✅ pure git
  [hn.STASHES]:         <stash factory>,           // ✅ pure git
  [hn.SUBMODULES]:      <submodule factory>,       // ✅ pure git
  [hn.TAGS]:            <tags factory>,            // ✅ pure git
  [hn.TEAM_VISIBILITY]: <team factory>,            // ❌ GK service
  [hn.WORKTREES]:       <worktree factory>,        // ✅ pure git
};

getMaybeLeftPanelSections =
  createSelector(...ORDERED_LEFT_PANEL_HEADER_KEYS.map(k => Ur[k]),
                 (...sections) => sections);
```

After that, three selectors filter the list:

```js
getValidLeftPanelSections = createSelector(
  getMaybeLeftPanelSections, getIsCurrentTabASandboxTutorialTab,
  (sections, isTutorial) => compact(sections)
                              .filter(({key}) => !isTutorial || key === LOCAL));

getHiddenLeftPanelSections = createSelector(
  hiddenSections, toggledSections,
  submodulesList, unfilteredTags, worktrees, userMilestones,
  (hidden, toggled, subs, tags, wts, ms) =>
    ORDERED_LEFT_PANEL_HEADER_KEYS.filter(k =>
      k === SUBMODULES   ? (toggled.includes(k) ? hidden.includes(k) : subs.length === 0) :
      k === TAGS         ? (toggled.includes(k) ? hidden.includes(k) : tags.length === 0) :
      k === WORKTREES    ? (toggled.includes(k) ? hidden.includes(k) :
                            !ms.usedWorktrees && wts.length < 2) :
      hidden.includes(k)));

getLeftPanelSections = createSelector(
  getHiddenLeftPanelSections, getValidLeftPanelSections,
  (hidden, valid) => valid.filter(s => !hidden.includes(s.key)));
```

The key insight here is that `SUBMODULES`, `TAGS`, and `WORKTREES`
are **auto-hidden when empty** *unless the user has explicitly
toggled them* (the `toggledSections` array tracks "user has touched
this section's visibility"). That's why a brand-new repo with zero
tags doesn't show an empty `TAGS` section — but once the user
right-clicks and "Show Tags," it stays visible even when the count
goes back to zero. Mirror this in chajá.

`SECTION_VALIDITY` is computed from per-section selectors:

```js
getLeftPanelSectionValidity = createSelector(
  getIsCurrentTabASandboxTutorialTab,
  getShowGitFlowSection,         // git flow init was run
  getShowStashSection,           // any stashes exist
  getShowIssueTrackerSection,    // issue tracker connected
  getShowTeamVisibilitySection,  // GK service feature
  getShowPullRequestSection,     // any remote on a known provider
  getShowCloudPatchesSection,    // GK service feature
  (isTut, gitflow, stash, issues, team, pr, cloud) =>
    isTut
      ? Object.fromEntries(Object.keys(HEADER_KEYS).map(k => [k, k === LOCAL]))
      : { CLOUD_PATCHES: cloud,  GITFLOW: gitflow,  ISSUES: issues,
          LOCAL: true,  PULL_REQUESTS: pr,  REMOTE: true,
          STASHES: stash,  SUBMODULES: true,  TAGS: true,
          TEAM_VISIBILITY: team,  WORKTREES: true });
```

`LOCAL` and `REMOTE` are always valid (every git repo has both).
`SUBMODULES`, `TAGS`, `WORKTREES` are validity-true and culled
later. Everything else is conditional on a feature being available.

## Per-section section object shape

Every factory returns the same shape (built by `getLeftPanelSection`
helper):

```js
{
  key:              "LOCAL",        // HEADER_KEY
  headerComponent:  LocalHeader,    // <h2>-row component
  headerProps:      { count, isExpanded, isFiltering, translate },
  height:           HEADER_HEIGHT,  // 30 — height of the header chrome
  count:            <number>,       // shown next to header label
  rows:             [ {height, contentComponent, props} … ],
  collapsedHeaderElement: <CollapsedFooHeader … />,  // shown when leftPanel collapsed
}
```

The chajá equivalent should produce the same shape from one
`createMemo` per section, source-keyed on the relevant nonces (refs,
remotes, stashes, etc). One section file, one selector chain, one
factory function — exactly the GK split.

## Top-level component tree

```
<div className="left-panel">
  { isCollapsed
      ? <LeftPanelCollapsed … />              // narrow rail of icons (covered in doc 01)
      : <Resizable resizeEdge="right"
                   id="expanded-left-panel-container"
                   …>
          <FlexContainer direction="column" height="100%" width="100%">
            { showLeftPanelWorkflowView &&
                <LeftPanelWorkflowViewSwitcher … /> }
            { viewMode === LeftPanelViewMode.List && (
              <>
                <LeftPanelFilterInput
                   clearQueryFn  filterValue  isFilterFocused
                   isFiltering   isSoloing    label
                   onContextMenu onFilterBlur onFilterFocus
                   onQueryChange refCountDenominator refCountNumerator
                   resetFn       resetLabel   showCollapseButton
                   togglePanelFn translate />
                <div className="panel-bg0 scrollbar-bg1"
                     style={{ flex:1, minHeight:0,
                              overflowY: handleBounds.fixed ? "auto" : "hidden" }}>
                  <AutoSizer onResize={onHeightUpdated}>
                    {({width}) =>
                      <div style={{ position:"absolute", height:heightOfSections }}>
                        {!handleBounds.fixed && <DragHandles
                            handleBounds   height
                            onDragCompleted onSectionsUpdated
                            sections setIsHandleDragging /> }
                        <div style={{ width, height:heightOfSections }}>
                          { leftPanelSections.map(section =>
                              <LeftPanelSection
                                addButtonFns       aliases
                                headerOnClickFns   isSectionExpandedByKey
                                key={section.key}  onLeftPanelRowClick
                                onLeftPanelSectionContextMenu
                                refDispatchProps   refreshButtonFns
                                section            sectionHeight
                                supportedIssueTrackerTypes
                                toggleFolderShown  toggleFolderSoloed
                                toggleStashShown   translate />) }
                        </div>
                      </div>}
                  </AutoSizer>
                </div>
              </>) }
            { viewMode === LeftPanelViewMode.Workflow &&
                <AgentWorkflowPanel /> }            // ❌ AI workflow, out of scope
          </FlexContainer>
        </Resizable> }
  { (isCheckingOutBranch || isMultiDeletionInProgress)
      && <SpinOverlay message="Checking out branch…" /> }
</div>
```

Initial width default: **215 px** (from the `RefPanel: { height:300, open:!0, width:215 }`
default-state literal in the bundle). Resize edge is **right** (the panel
grows away from the leftmost rail). The hard min/max clamp values are
not exposed as plain constants — they're computed at render time
against `window.innerWidth` and the toolbar/right-panel widths, so a
literal grep of the bundle does not surface them. Treat 215 as the
**default**, not the minimum.

Persistence goes to `["layout","RefPanel","width"]`. Note the name on
disk is `RefPanel`, not `LeftPanel` — historical name from before the
section-system refactor. Don't be confused.

## Persistence (per-profile + per-repo)

| Path | Scope | What |
|------|-------|------|
| `["layout","RefPanel","width"]` | profile | width in px (set on resize end) |
| `["layout","RefPanel","height"]` | profile | container height (rare, mostly window-derived) |
| `["layout","RefPanel","open"]`   | profile | preferred open/closed |
| `["ui","leftPanel","hiddenSections"]` | profile | array of HEADER_KEYS the user toggled off |
| `["ui","leftPanel","toggledSections"]` | profile | array of HEADER_KEYS the user has *ever touched* (drives "auto-hide-when-empty" override) |
| `["layout","leftPanel","sectionYsByKey"]` | repo | per-repo Y positions of each section divider after drag-resize |
| `leftPanelQuery` | repo | last filter string, debounced 250 ms |
| `collapsedRemotes` | repo | array of remote names with their per-remote tree collapsed |
| `collapsedBranchFolders` | repo | array of folder keys collapsed in LOCAL/GITFLOW/REMOTE/TAGS trees |
| `hiddenRefs` | repo | array of ref full-names hidden via the eye toggle |
| `hiddenRemotes` | repo | array of remote names hidden via the eye toggle |
| `hideAddUserForkAsRemoteSuggestion` | repo | dismissed suggestion banner |
| `["pullRequests","collapsedFilters"]` | repo | collapsed PR filter group ids |
| `["issues",<trackerType>,"collapsedFilters"]` | repo | per-tracker collapsed issue filter group ids |
| `["teams","collapsedRepositories"]` | repo | collapsed team-visibility repo group keys |

The split is deliberate: things that are *user-wide* (which sections
exist, panel width) live in profile; things that are *repo-wide*
(which folders are collapsed in this specific repo) live in repo
settings. Mirror that split.

## Hide-all / show-all (per-section bulk operation)

For LOCAL / REMOTE / STASHES / TAGS only, the section context menu
exposes "Hide all" and "Show all" entries:

```js
case LOCAL:
  if (showAll) yield call(resetAllRefIsHidden);                  // clear hiddenRefs
  else yield call(setRepoSetting, "hiddenRefs",
                  localRefs.map(r => r.fullName), repoPath);
  break;
case REMOTE:
  if (showAll) yield call(showAll);
  else { yield call(setRepoSetting, "hiddenRemotes",  remotes.map(r=>r.name), repoPath);
         yield call(setRepoSetting, "collapsedRemotes", remotes.map(r=>r.name), repoPath); }
  break;
case STASHES: yield call(showAll ? showAllStashes : hideAllStashes); break;
case TAGS:    yield call(showAll ? showAllTags    : hideAllTags);    break;
```

Bulk hide of REMOTE *also* collapses every remote (so you don't see
the per-remote header rows for remotes you just hid). That's a nice
touch chajá should copy.

## chajá implementation hint

- Keep the constants in one module (`leftPanelKeys.ts`); export the
  exact same `ORDERED_LEFT_PANEL_HEADER_KEYS` array. No
  alphabetisation. No "let's improve the order while we're at it" —
  every deviation costs 1:1 parity.
- The dispatch-table pattern is the right shape. One file per
  section's selector chain, one `Ur` table that imports them all,
  one root selector that runs the table.
- Persistence split (`profile` vs `repo`) maps to chajá's existing
  settings store cleanly. Use the same keys verbatim — except rename
  `RefPanel` → `LeftPanel` in chajá since GK's name is a historical
  accident.
- Auto-hide-when-empty is gated by a separate `toggledSections`
  array. **Don't** simplify this to "hide if `count === 0`" —
  doing so means a user who has hand-toggled "Show Tags" would
  lose the section the moment they delete the last tag. That's a
  visible regression.
