# WORKTREES + SUBMODULES sections

Both sections are pure-git, both are conditional, both follow the
"auto-hide-when-empty unless explicitly toggled" pattern from doc 00.

## Auto-hide rules

From `getHiddenLeftPanelSections`:

```js
k === SUBMODULES
  ? (toggled.includes(k) ? hidden.includes(k) : subs.length === 0)
k === WORKTREES
  ? (toggled.includes(k) ? hidden.includes(k)
                         : !ms.usedWorktrees && wts.length < 2)
```

- **SUBMODULES**: auto-shown iff there's at least one submodule.
- **WORKTREES**: auto-shown iff *either* the user has ever used
  worktrees in any repo (`userMilestones.usedWorktrees` is a
  one-way flag) **or** this repo has at least 2 worktrees (the
  main worktree + at least one extra).

The "2 worktrees" floor is interesting: a repo with exactly one
worktree (the main one) doesn't show the section, because that's
the no-worktrees state from a feature-discovery perspective. Once
the user adds a second worktree, the section appears, and once
the milestone is set, the section stays available across all
repos forever (clever onboarding nudge).

## SUBMODULES — selectors (file `/37988`)

```js
getFilteredSubmodulesAndNamesToFuzzyStrings = createSelector(
  getQuery, getSubmodulesList,
  (q, list) => filterListByKey(q, list, ["path"]));

getFilteredSubmodules           = createSelector(getFilteredSubmodulesAndNamesToFuzzyStrings, V => V.list);
getFilteredSubmoduleNamesToFuzzyStrings
                                = createSelector(getFilteredSubmodulesAndNamesToFuzzyStrings, V => V.namesToFuzzyStrings);
getFilteredSubmodulesCount      = createSelector(getFilteredSubmodules, size);

getSubmoduleRows = createSelector(
  getFilteredSubmodules,
  getFilteredSubmoduleNamesToFuzzyStrings,
  getSubmoduleUpdateProgresses,             // { [name]: percentage } for in-flight updates
  getIsInUnsupportedRebase,
  getRepoPathWithDotGit,
  getTranslationFn,
  (subs, fuzzy, progresses, isRebase, dotGit, translate) =>
    map(submodule => {
      const { ahead, behind, name } = submodule;
      return {
        contentComponent: SubmoduleRow,
        height: REF_HEIGHT,
        props: {
          ahead, behind,
          canBeHidden: false,                    // submodules can't be eye-toggled hidden
          isInUnsupportedRebase: isRebase,
          key: name,
          name: fuzzy[submodule.path] || name,
          sectionKey: SUBMODULES,
          submodule,
          submoduleStatusElement: getStatusElements(submodule, dotGit, translate),
          submoduleUpdateProgress: progresses[submodule.name],
          type: SUBMODULE,
        }
      };
    }, subs));

getSubmoduleHeaderProps = createSelector(
  getFilteredSubmodulesCount,
  getIsInUnsupportedRebase,         // disable add-button during merge conflict
  getIsLeftPanelFiltering,
  getIsSectionExpandedByKey,
  getTranslationFn,
  (count, isRebase, isFiltering, expanded, translate) => ({
    addButtonDisabled: isRebase,
    addButtonToolTip:  translate("RefBar-AddSubmodule"),
    count, isFiltering,
    isExpanded: expanded[SUBMODULES],
    translate,
  }));
```

### Submodule row anatomy

```
[icon (with status overlay)]    [name]    [ahead/behind]    [progress %]
```

- **Status overlay**: red dot if uninitialized, yellow dot if
  modified, green if clean. Status comes from
  `getStatusElements(submodule, dotGit, translate)` — combines
  `git submodule status` flags with the inner repo's working tree
  state.
- **Ahead/behind**: relative to the parent's pinned commit and the
  submodule's own remote tracking branch.
- **Progress %**: shows during a `submodule update` operation.

### Submodule context menu

```js
popupSubmoduleMenu = (submodule, sectionKey) => ({ saga: function*(d){
    const { isDeleted, isUninitialized, name } = submodule;
    const actions    = yield call(getAvailableActions, submodule);
    const { commit, initialize, reset } = actions;
    const translate  = yield select(getTranslationFn);
    const gitBin     = yield select(getIsGitBinaryEnabled);
    const menu = yield call(buildSubmoduleContextMenu, {
        commit, initialize,
        isDeleted, isUninitialized,
        shouldReset: reset,
        submodule, submoduleName: name,
        translate, isGitBinaryEnabled: gitBin,
        sectionKey,
    });
    yield d.call(popupMenu, menu);
});
```

The action set is dynamic via `getAvailableActions(submodule)` —
which entries are present depends on the submodule's current state:

- Uninitialized → "Initialize"
- Initialized, clean → "Update", "Open in new tab"
- Initialized, dirty → "Reset", "Commit", "Update"
- Deleted → "Remove"

Plus always: `Open in file manager`, `Open in terminal`, `Copy
submodule path`.

## WORKTREES — selectors (file inferred via `getWorktrees`)

```js
getWorktrees: state => state.worktree.worktrees;
```

The selectors mirror SUBMODULES (filter by path, build rows, etc.)
but the per-row data is `{path, branchName, headSha, isLocked,
isBare, isPrunable, isPathMissing}`.

### Worktree row anatomy

```
[icon (locked / detached / missing overlay)]    [name (branch or short path)]    [ahead/behind]
```

The row's primary identifier is the **branch** at HEAD of the
worktree (since worktrees in practice host one checked-out branch
each). For detached worktrees, the row shows the short SHA.

### Worktree context menu

```js
popupWorktreeMenu = (worktree, allWorktrees, sectionKey) => ({ saga: function*(d){
    const translate    = yield select(getTranslationFn);
    const repo         = yield select(getRepo);
    const deletingDirs = yield select(getWorktreeDeletingWorkdirs);
    let menu = [];
    if (repo) menu = yield call(buildWorktreeContextMenu, {
        worktree, worktrees: allWorktrees,
        currentWorkDir: ensureTrailingSlashRemoved(repo.workdir()),
        isDeleting: deletingDirs.includes(worktree.workdir),
        sectionKey, translate,
    });
    yield d.call(popupMenu, menu);
});
```

Menu entries (i18n keys):

| Key | Action |
|-----|--------|
| `ContextMenu-CreateWorktreeFrom` (header item, not row) | New worktree wizard |
| `ContextMenu-OpenWorktreeFromBranch` | Switch this tab to the worktree |
| `ContextMenu-CreateBranchHere` | Create branch in this worktree |
| `ContextMenu-CreateWorktreeFromBranch` (on a branch row) | New worktree from a LOCAL row's branch |
| `ContextMenu-CreateWorktreeFromCommit` (on a commit) | New worktree from a graph commit |
| Lock / Unlock | flip `worktree.lock` |
| Move | `git worktree move` |
| Remove | `git worktree remove` (or `--force` if dirty) |

The "current" worktree (matching `repo.workdir()`) is excluded
from "Remove" — you can't remove the worktree you're operating
inside.

## Header buttons

| Section | Add | Refresh |
|---------|-----|---------|
| WORKTREES | + → opens "Create worktree" wizard | — |
| SUBMODULES | + → opens "Add submodule" wizard | — |

Both add buttons disable themselves during an unsupported-rebase
state (`getIsInUnsupportedRebase`), to prevent half-baked tree
changes during conflict resolution.

Neither section has a refresh button — both are derived from local
state changes (worktree create/remove emits an event; submodule
init/update emits an event).

## chajá implementation hint

- WORKTREES requires a backend op `list_worktrees(repo)` returning
  `[{path, branchName, headSha, isLocked, isBare, isPrunable,
  isPathMissing}]`. `gix` exposes worktree enumeration via
  `Repository::worktrees()`.
- SUBMODULES requires `list_submodules(repo)` returning `[{name,
  path, headSha, parentSha, isInitialized, isDeleted, status}]`.
  `gix` has submodule support though it's less ergonomic than the
  CLI; you may want to shell out to `git submodule status` for the
  status flags.
- Implement the auto-hide-with-toggle-override pattern *correctly*
  for both. The "2 worktrees" floor on WORKTREES is a deliberate
  feature-discovery nudge — keep it.
- The worktree "Open in new tab" and "Switch tab to worktree"
  actions assume chajá has a tab/repo concept. Wire to whatever
  tab system chajá ends up with; if there's no tabs in v1, the
  menu becomes "Open in file manager" only.
- The submodule update progress bar requires the backend to emit
  progress events during `git submodule update`. v1 can show a
  spinner instead of a percentage; refine later.
