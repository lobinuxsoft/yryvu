# STASHES section

Pure git data: `git stash list` plus the underlying commit graph.
Section is auto-shown only when there's at least one stash.

## Show condition

```js
getShowStashSection = createSelector(
  getStashesBySha,
  Ve => Object.keys(Ve).length > 0);
```

So unlike TAGS/SUBMODULES/WORKTREES, STASHES doesn't have an
"auto-hide-but-respect-toggle" override — it's purely "show if
non-empty". If you stash, the section appears; if you drop the
last stash, it disappears.

This is mildly inconsistent with how the other auto-show sections
behave but probably fine: stashes are ephemeral by nature, and
hiding them when empty matches user mental model.

## Selectors (file `/39687`)

```js
getFilteredStashesAndNamesToFuzzyStrings = createSelector(
  getQuery, getStashesBySha,
  (query, stashes) => filterListByKey(query, values(stashes), ["message"]));

getFilteredStashes              = createSelector(getFilteredStashesAndNamesToFuzzyStrings, get("list"));
getFilteredStashNamesToFuzzyStrings = createSelector(getFilteredStashesAndNamesToFuzzyStrings, get("namesToFuzzyStrings"));
getFilteredStashCount           = createSelector(getFilteredStashes, size);

getStashRows = createSelector(
  getFilteredStashes,
  getFilteredStashNamesToFuzzyStrings,
  getIsInUnsupportedRebase,
  getStashSelectionMap,             // { [oid]: true } from LeftPanelStashSectionSelectedShas
  getIsHiddenBySha,                 // { [oid]: true } from per-repo hidden stashes
  (stashes, fuzzy, isRebase, selMap, hiddenMap) =>
    map(stash => mapStashToLeftPanelRow(stash, fuzzy[stash.message], isRebase, selMap, hiddenMap),
        stashes));

function mapStashToLeftPanelRow(Ve, at, ct, dt, ln) {
  const { commit, sha, branchName, message } = Ve;
  const stashOid    = extractStashOid(Ve);
  const isSelected  = dt[stashOid] || false;
  const isHidden    = ln[stashOid] || false;
  return {
    contentComponent: StashRow,
    height: REF_HEIGHT,             // 24
    props: {
      canBeHidden: true,
      isHidden,
      isInUnsupportedRebase: ct,
      isSelected,
      key: sha,
      name: at || commit.message,    // alias falls back to commit message
      sectionKey: STASHES,
      stashBranchName: branchName,
      stashOid,
      stashMessage: message,
      type: STASH,
    }
  };
}
```

## Stash row anatomy

```
[eye-toggle]    [stash-icon]    [name]
```

No depth/folder logic for stashes (they're a flat list, ordered
newest-first by stash-stack position). The `name` is the stash
message; the tooltip shows the underlying commit's `branchName`
(the branch the stash was taken from).

## Click behaviour

Single click selects the stash → `selectCommit(stashOid)` → graph
navigates to it, right panel shows commit details.

```js
[STASH]: {
  clickHandler: ({stashOid}) => ({ saga: function*(d){
      yield d.call(selectCommit, stashOid);
      yield call(setLeftPanelSelection, { type: STASH, shas: [stashOid] });
  }}),
  ctrlClickHandler: ({stashOid}) => ({ saga: function*(d){
      const sel = (yield select(getLeftPanelStashSectionSelectedShas)) || [];
      const isAlreadyIn = findIndex(s => s === stashOid, sel) >= 0;
      if (!isAlreadyIn) yield d.call(selectCommit, stashOid, {shouldClearLeftPanelSelection:false});
      const newSel = isAlreadyIn ? remove(s => s === stashOid, sel) : [...sel, stashOid];
      yield call(setLeftPanelSelection, { type: STASH, shas: newSel });
  }}),
  shiftClickHandler: ({stashOid}) => ({ saga: function*(d){
      const anchor = yield select(getLastLeftPanelStashSectionShaSelected);
      if (!anchor) return d.call(this.clickHandler, /*…*/);
      yield d.call(selectCommit, stashOid, {shouldClearLeftPanelSelection:false});
      const stashList = yield select(getStashShas);
      const sel       = yield select(getLeftPanelStashSectionSelectedShas);
      const newSel = getNewSelectionForShiftClick(
                       s => findIndex(o => o === s, stashList),
                       s => findIndex(o => o === s, sel) >= 0,
                       stashOid, anchor, sel, stashList);
      yield call(setLeftPanelSelection, { type: STASH, shas: newSel });
  }})
}
```

Multi-select stashes (Ctrl-click / Shift-click) is implemented the
same way as branches. The right panel switches to a multi-select
mode for stash apply/drop operations on the whole set.

## Context menu (per stash)

```js
const popupStashMenu = (sha, sectionKey) => ({ saga: function*(d){
    const isDrafts = yield select(getIsDraftsEnabled);    // GK service feature
    const isHidden = yield select(getIsHiddenForSha, {sha});
    const translate= yield select(getTranslationFn);
    const menu = yield call(buildStashContextMenu, {
        isDraftsEnabled: isDrafts,                         // → enables "Export to Cloud Patch" (skip)
        isHidden,
        sectionKey,
        sha,
        translate,
    });
    yield d.call(popupMenu, menu);
});
```

Menu entries (i18n keys):

| Key | Action |
|-----|--------|
| `ContextMenu-StashApply` | `git stash apply <oid>` |
| `ContextMenu-StashPop`   | `git stash pop <oid>`   (apply + drop)|
| `ContextMenu-StashDelete`| `git stash drop <oid>`  |
| `ContextMenu-AmendStashMessage`| edit stash message in place (rebases the stash commit) |
| `ContextMenu-ExportStashToCloudPatch` | **OUT OF SCOPE** — uploads stash to GK Cloud Patches service |

For multi-selected stashes (`popupMultiSelectedStashesMenu`), the
menu reduces to `Delete N stashes`, `Hide N stashes`, `Show N stashes`
— the apply/pop variants are single-stash only because applying
multiple stashes in batch has no clean semantics.

There's no "view stash diff" menu entry — clicking the stash row
already navigates the graph to the stash commit and the right panel
shows its diff. The menu is for *operations*.

## Header

```js
getStashHeaderProps = createSelector(
  getFilteredStashCount,
  getIsLeftPanelFiltering, getIsSectionExpandedByKey, getTranslationFn,
  (count, isFiltering, expanded, translate) => ({
    count, isFiltering, isExpanded: expanded[STASHES], translate,
  }));
```

No add button (stashes are created from the staging area, not the
header). No refresh (stash list is local and immediate).

## chajá implementation hint

- New backend op needed: `list_stashes(repo)` returning `[{oid,
  message, branchName, parentSha, indexSha, untrackedSha, when}]`.
  `gix` exposes this through the reflog of `refs/stash` (each
  stash entry is a 2- or 3-parent merge commit pointed at by
  `refs/stash@{n}`).
- Operations: `stash_apply(oid)`, `stash_pop(oid)`, `stash_drop(oid)`,
  `stash_amend_message(oid, newMessage)`. Apply/pop emit a working
  tree change, so they need to be wired through the same
  conflict-detection flow as merge/rebase.
- Multi-select is shift/ctrl click, same as branches. Reuse the
  `getNewSelectionForShiftClick` helper.
- Skip "Export to Cloud Patch" — that's the GK service.
- Don't add a "view stash diff" menu entry; the row click already
  drives the graph + right panel. Adding a menu entry would
  duplicate behaviour and confuse.
