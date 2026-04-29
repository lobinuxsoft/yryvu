# LOCAL + REMOTE sections

Both sections share row anatomy and folder/grouping logic, so they
get treated as one doc. Nothing here requires a GitKraken backend
service: pure git data, derivable from `gix` (refs, upstream config,
ahead/behind walks, fetch state).

## LOCAL section — selectors

The full LOCAL section is built by these selectors (file `/14844`):

```js
// 1. Build per-row props for every visible local ref (or its parent folder).
getLocalRefRows = createSelector(
  getIsLeftPanelHandleDragging,        // dim/skip animations during drag
  getFilteredLocalRefs,                // local refs after filter
  getFilteredRefNamesToFuzzyStrings,   // map name → highlight ranges
  getIsSoloing,
  getCollapsedBranchFolders,           // per-repo array of folder keys
  getIsInUnsupportedRebase,            // disable everything during merge conflict
  getRefsTree,
  getRepoPath,
  getLocalSelectionMap,                // { fullName: true } for selected refs
  getIsMultiSelectingLocalRefs,
  (isDragging, refs, fuzzy, isSolo, collapsed, isRebase, tree, repoPath, selMap, isMulti) =>
    map(({ containsCheckedOutRef, folderName, folderPathWithFuzzyDelimiters,
           depth, isCollapsed, ref, sectionKey }) =>
      folderName
        ? makeFolderRow({                          // folder card
            folderPath: folderPathWithFuzzyDelimiters,
            folderName, collapsedFolders: collapsed,
            sectionKey, depth, isLeftPanelSoloing: isSolo,
            isHidden: isRefHidden(tree.refs, `refs/heads/${folderPathWithFuzzyDelimiters}`),
            isSoloed: isSolo && isFolderSoloed(refs, folderPathWithFuzzyDelimiters),
            isCollapsed, containsCheckedOutRef,
            folderType: "branch",
            isParentHidden: false,
            repoPath,
          })
        : makeBranchRow(ref, /*…*/, isCheckedOut, isHidden, …),
      organizeRefsIntoFolders({ refs, sectionKey: LOCAL, collapsedFolders: collapsed,
                                namesToFuzzyStrings: fuzzy }))
);

// 2. Branch row factory.
function makeBranchRow(isDragging, isSoloing, ref, depth, alias, isRebase, sectionKey,
                      isSelected=false, isMultiSelecting=false) {
  const { ahead, behind, fullName, isActive, isHidden, isSoloed, name, sha } = ref;
  return {
    height: REF_HEIGHT,                // 24
    contentComponent: RefWithDragAndDrop,
    props: {
      ahead, behind,
      canBeHidden: true,
      isLeftPanelHandleDragging: isDragging,
      depth,
      fullName,
      gitRef: ref,
      isCheckedOut: isActive,
      isHidden,
      isInUnsupportedRebase: isRebase,
      isLeftPanelSoloing: isSoloing,
      isMultiSelectingLocalRefs: isMultiSelecting,
      isSelected,
      isSoloed,
      key: `${fullName}-${sectionKey}`,
      name: makeShortRefNameFromRefNameAndDepth(alias || name, depth),
      sectionKey,
      sha,
      type: BRANCH,
    }
  };
}

// 3. Header props.
getLocalHeaderProps = createSelector(
  getFilteredVisibleLocalRefCount,    // numerator (visible + matches filter)
  getFilteredLocalRefCount,           // denominator (matches filter, including hidden)
  getIsLeftPanelFiltering,
  getIsSectionExpandedByKey,
  getTranslationFn,
  (countN, countD, isFiltering, expanded, translate) => ({
    countNumerator:   countN,
    countDenominator: countD,
    isFiltering,
    isExpanded:       expanded[LOCAL],
    translate,
  }));

// 4. Wire it all together.
default = createSelector(
  getLocalRefRows, getLocalHeaderProps,
  getCollapsedLocalHeaderElement,    // CollapsedLocalHeader for the rail
  getFilteredLocalRefCount,
  (rows, headerProps, collapsed, count) =>
    getLeftPanelSection(LocalHeader, HEADER_HEIGHT,
                        headerProps, rows, collapsed, LOCAL, count));
```

`organizeRefsIntoFolders` is the recursive helper that turns a flat
ref list into a `[ {ref|folderName, depth, isCollapsed,
containsCheckedOutRef, …} ]` flat-rendered tree, given the user's
collapsed-folder set. The "depth" prop drives the indent.

## Branch row anatomy (`RefWithDragAndDrop`)

Inferred from the props bag and the existing graph-row research:

```
[indent (depth × 16 px)]
[chevron OR spacer]    [eye-toggle]    [icon]    [name]    [ahead/behind]    [HEAD ✓]
```

- **Indent**: `depth × 16 px` (folder tree depth).
- **Chevron**: only on folder rows — toggles `collapsedBranchFolders`.
- **Eye-toggle**: toggle visibility — driven by `canBeHidden`. Updates
  `hiddenRefs` (LOCAL) / `hiddenRemotes` (REMOTE).
- **Icon**: branch glyph; `HEAD ✓` overlay if `isActive`.
- **Name**: `makeShortRefNameFromRefNameAndDepth` strips off the
  folder path that's already shown by the parent folder row.
- **Ahead/behind**: two pills `↑ahead ↓behind` next to the upstream
  link, only when `upstream` exists.
- **HEAD ✓**: filled circle/check on the active ref.

A branch with no upstream renders without the ahead/behind pills.
A detached HEAD renders the row with a `(HEAD)` adornment instead
of a checkmark — the existing graph code surfaces this via
`isRefDetachedHead`.

## REMOTE section — per-remote nesting

REMOTE is structurally different: it's *two-level* — a per-remote
"repo" row, then nested per-branch rows under each remote, each with
their own folders. From file `/35054`:

```js
getRemoteRows = createSelector(
  getIsLeftPanelHandleDragging,
  getRemotesWithMetadata,              // list of remotes (origin, upstream, fork…)
  getFilteredRefNamesToFuzzyStrings,
  getQuery,
  getRefsByRemote,                     // groupBy("remoteName") on filtered remote refs
  getActiveFetches,                    // { [remoteName]: {silent, …} }
  getCollapsedRemotes,                 // per-repo array of remote names with body collapsed
  getCollapsedBranchFolders,
  getIsSoloing,
  getIsInUnsupportedRebase,
  getRefsTree,
  getRepoPath,
  getShouldShowAddUserForkAsRemoteSuggestion,
  getMaybeNonLocalUserForksByHostingServiceType,
  getTranslationFn,
  (isDragging, remotes, fuzzy, query, refsByRemote, fetches,
   collapsedRemotes, collapsedFolders, isSoloing, isRebase, tree, repoPath,
   showFork, forks, translate) =>
    flow([
      sortBy("name"),                  // remotes alphabetically
      transform((acc, remote) => {
        const refs = refsByRemote[remote.name];
        if (isEmpty(refs) && !isEmpty(query)) return;        // hide empty remote when filtering

        const fetchStatus = (fetches[remote.name] && !fetches[remote.name]?.silent)
                            ? fetchStatus.IN_PROGRESS : null;

        // Per-remote header row (REPO type)
        const remoteRow = makeRemoteRow(remote, fetchStatus, isSoloing,
                                        collapsedRemotes, alias, repoPath, REMOTE);

        // Nested branch/folder rows under this remote
        const branchRows = collapsedRemotes.includes(remote.name) ? [] :
          map(/* same folder/branch shape as LOCAL but with remoteBranchPrefix */,
              organizeRefsIntoFolders({ refs, sectionKey: REMOTE,
                                        collapsedFolders, namesToFuzzyStrings: fuzzy }));

        acc.push(remoteRow, ...branchRows);
      }, []),
    ])(remotes)
);
```

The "REPO row" is just a row with `type: REPO`, rendered by the
same content component as folders — it gets a chevron, the remote's
host icon (GitHub/GitLab/Bitbucket/Azure), and the `silent fetch
failed` warning glyph if applicable.

The `getShouldShowAddUserForkAsRemoteSuggestion` selector triggers
an extra "Add my fork as a remote" suggestion row at the top of
REMOTE *if* the user is logged in to a provider where they have a
fork of the upstream repo. **This requires a provider integration
to know about the user's forks** — pure-git can't know which forks
exist on GitHub. For chajá: skip this suggestion row in v1, add
later as a provider-feature.

## Per-remote refresh

Each `RemoteRow` carries its own refresh handler — clicking the
refresh icon on a remote header row triggers `git fetch <that
remote>`. The header itself doesn't have a "refresh all remotes"
button (that lives on the toolbar's `Pull` / `Fetch` button).

`getActiveFetches` returns `{ [remoteName]: { silent: boolean,
startedAt: number } | undefined }`. The refresh icon spins for that
specific remote while a fetch is in flight.

## Hide-all / show-all

For LOCAL and REMOTE, the section context menu's "Hide all" /
"Show all" entries (covered in doc 00) are wired through:

```js
case LOCAL:
  if (showAll) yield call(resetAllRefIsHidden);                     // wipe hiddenRefs
  else yield call(setRepoSetting, "hiddenRefs",
                  localRefs.map(r => r.fullName), repoPath);
  break;
case REMOTE:
  if (showAll) yield call(showAll);
  else { yield call(setRepoSetting, "hiddenRemotes",  remotes.map(r=>r.name), repoPath);
         yield call(setRepoSetting, "collapsedRemotes", remotes.map(r=>r.name), repoPath); }
  break;
```

REMOTE is special: hiding all remotes also collapses them
(otherwise you'd have a long list of empty remote headers
dangling). Mirror this pairing.

## Smart Branches — FLAG

```js
smartBranchesEnabled: getSmartBranchesEnabled(state),
…
disableSmartBranchesVisibility: () =>
  getSmartBranchesService().setEnabled(null, false, SmartBranchesContexts.LEFT_PANEL)
                           .catch(() => {}),
```

"Smart branches" is a feature where GK auto-groups your branches
into curated views (e.g. "your branches", "in-progress PRs",
"recent activity"). The grouping logic itself is computed
client-side from git data, **but** the heuristics (which branches
are "yours", what counts as "in progress", etc.) lean on the
optional GK account data:

- "Your branches" needs to know *who you are* — derivable from
  `user.email` in git config (no service required).
- "In-progress PRs" needs PR data — provider integration only,
  works without GK service if the user has a GitHub/GitLab token.
- "Recent activity" needs activity stream — *possibly* derivable
  from the local git reflog plus PR open dates, but GK feeds it
  from its own activity service.

**FLAG**: a chajá-equivalent of Smart Branches could be ~80%
implemented from pure git + provider APIs (LOCAL section grouped
by your-vs-others heuristics). The "recent activity" axis would
have to be reduced to "branches modified in the last N days"
(reflog-derivable), losing the cross-repo dimension that GK's
service provides.

Recommendation: **skip Smart Branches in v1**, add it as a v2
feature flag if user demand is real. The grouping heuristics
matter as much as the rows do, and reverse-engineering them well
takes effort that's better spent elsewhere.

## Selection model (multi-select with shift / ctrl)

The click handlers in `/14834` are sophisticated:

```js
[BRANCH]: {
  clickHandler:    ({gitRef}) => single-select that ref + selectCommit(ref.sha),
  ctrlClickHandler:({gitRef}) => add/remove ref from multi-select set,
  shiftClickHandler:({gitRef}) => range-select between last-clicked and this,
}
```

Range-select (`shift`) walks the *flattened, organised* row list to
build the inclusive range. Because the rows are pre-organised into
folders, the shift-range respects the visible order — so shift-click
across a collapsed folder selects every branch in the visible list,
including any that happen to be in a different folder.

`getNewSelectionForShiftClick` is the helper:

```js
getNewSelectionForShiftClick = (indexFn, isInSelectionFn, target, anchor, currentSelection, list) => {
  const a = indexFn(anchor), b = indexFn(target);
  const lo = Math.min(a,b), hi = Math.max(a,b);
  const additions = [];
  for (let i = lo; i <= hi; i += 1) {
    const ref = list[i];
    if (!isInSelectionFn(ref)) additions.push(ref);
  }
  return [...currentSelection, ...additions];
};
```

Important: the multi-selection of refs and the multi-selection of
*commits* are linked. Clicking a branch ref also calls
`selectCommit(sha)` so the graph and the inspector follow.
`shouldClearLeftPanelSelection: false` is passed when the selection
is being added to (not replaced) so the *previous* multi-selection
of refs survives.

## chajá implementation hint

- Build LOCAL and REMOTE on top of one shared `RefRow` SolidJS
  component. The only branch is REMOTE's per-remote header (type
  `REPO`) which adds a fetch-spinner icon — that can be a separate
  small component.
- `gix` gives you ahead/behind directly via `revwalk` between the
  local ref and `branch.<name>.merge` upstream. Cache per ref;
  invalidate on the same nonces that drive the LOCAL/REMOTE selectors.
- Folder-organising logic should be one pure function in TS:
  `organizeRefsIntoFolders({ refs, collapsedFolders, fuzzyMap })`
  → flat row list. Identical signature to GK's; trivial to test.
- Implement multi-select state (`selectedLocalRefs`,
  `selectedStashShas`) as separate SolidJS signals — *not* one
  union-typed signal. Each selection scope has its own click
  handler chain (Ctrl/Shift behaviour differs by row type).
- Skip Smart Branches in v1. File a separate issue if user
  demand surfaces; design the grouping heuristics from scratch
  rather than copying GK's (their service-fed signals would be
  faked badly).
- "Add my fork as a remote" suggestion row needs provider API
  knowledge of the user's forks. Skip in v1, add when GitHub
  integration lands.
