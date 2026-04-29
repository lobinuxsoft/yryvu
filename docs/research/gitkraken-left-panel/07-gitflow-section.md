# GITFLOW section

Pure git data: it's just LOCAL branches grouped by `gitflow.*`
config-derived prefixes (`feature/`, `release/`, `hotfix/`,
`support/`, plus the `develop` branch and the `master`/`main`
branch). Nothing service-side.

## Show condition

```js
getShowGitFlowSection = createSelector(
  getIsGitFlowInitialized,             // .git/config has [gitflow] section
  Boolean);
```

Section appears iff the user has run `git flow init` (or otherwise
populated the `[gitflow]` config section). The check is just "does
`gitflow.branch.develop` exist in config".

If gitflow isn't initialised, the section's add-button on the
header runs the init flow:

```js
addButtonToolTip: translate("RefBar-OpenGitFlow"),   // "Open Git Flow"
```

The "+" on the header opens a Git Flow management UI (init or
start-feature/start-release/etc.). Once init runs, the section
populates from the config.

## Selectors (file `/77386` / referenced by `/getAllGitFlowBranches`)

```js
getFilteredGitFlowBranchesAndNamesToFuzzyStrings = createSelector(
  getQuery,
  state => getAllGitFlowBranches(state),
  filterRefs);

getFilteredGitFlowBranches             = createSelector(getFilteredGitFlowBranchesAndNamesToFuzzyStrings, get("list"));
getFilteredGitFlowBranchNamesToFuzzyStrings = createSelector(getFilteredGitFlowBranchesAndNamesToFuzzyStrings, get("namesToFuzzyStrings"));
getFilteredGitFlowBranchesCount        = createSelector(getFilteredGitFlowBranches, size);

getGitFlowRefsAndFolders = createSelector(
  getFilteredGitFlowBranches, getFilteredGitFlowBranchNamesToFuzzyStrings, getCollapsedBranchFolders,
  (refs, fuzzy, collapsed) => organizeRefsIntoFolders({
      refs, sectionKey: GITFLOW, collapsedFolders: collapsed,
      namesToFuzzyStrings: fuzzy,
  }));

getGitFlowRows = createSelector(
  getIsLeftPanelHandleDragging,
  getFilteredGitFlowBranchNamesToFuzzyStrings,
  getGitFlowRefsAndFolders,
  getIsSoloing, getCollapsedBranchFolders, getIsInUnsupportedRebase,
  getRefsTree, getRepoPath, getFilteredGitFlowBranches,
  (isDragging, fuzzy, organised, isSoloing, collapsed, isRebase, tree, repoPath, refs) =>
    map(({ containsCheckedOutRef, folderName, folderPathWithFuzzyDelimiters,
           depth, isCollapsed, ref, sectionKey }) =>
      folderName
        ? makeFolderRow({
            folderPath: folderPathWithFuzzyDelimiters, folderName,
            collapsedFolders: collapsed, sectionKey, depth,
            isLeftPanelSoloing: isSoloing,
            isHidden: isRefHidden(tree.refs, `refs/heads/${folderPathWithFuzzyDelimiters}`),
            isSoloed: isSoloing && isFolderSoloed(refs, folderPathWithFuzzyDelimiters),
            isCollapsed, containsCheckedOutRef,
            folderType: "branch", isParentHidden: false, repoPath,
          })
        : makeBranchRow(/*…same as LOCAL…*/),
      organised));

getGitFlowHeaderProps = createSelector(
  getFilteredGitFlowBranchesCount,
  getIsInUnsupportedRebase,
  getIsLeftPanelFiltering, getIsSectionExpandedByKey, getTranslationFn,
  (count, isRebase, isFiltering, expanded, translate) => ({
    addButtonDisabled: isRebase,
    addButtonToolTip:  translate("RefBar-OpenGitFlow"),
    count, isFiltering,
    isExpanded: expanded[GITFLOW],
    translate,
  }));
```

`getAllGitFlowBranches(state, prefixes)` (helper inside `/17081`):
takes the gitflow config-derived prefix list and returns every
LOCAL ref whose name matches one of the prefixes, plus the
develop and master branches.

The rows themselves render with the **same** `RefWithDragAndDrop`
component as LOCAL — gitflow is structurally just LOCAL refs
re-grouped under different folder names. Same row anatomy,
same context menu.

## What you see in the section

By default, the gitflow folders are:

- `feature/` (+ master + develop pinned at top)
- `release/`
- `hotfix/`
- `support/` (less common)

The exact folder names come from the user's config:

```ini
[gitflow "branch"]
  master = main
  develop = develop
[gitflow "prefix"]
  feature = feature/
  release = release/
  hotfix = hotfix/
  support = support/
  versiontag = v
```

GK reads these from `.git/config` via the gitflow service. chajá
needs to do the same — read the `[gitflow ...]` config section if
present.

## Init flow (the + button)

Clicking the "+" opens a modal with the standard Git Flow init
prompts: choose the production branch, the development branch, and
the prefixes. Submitting writes the `[gitflow]` config section to
`.git/config` and then:

```js
state.gitflow.isInitialized → true
```

which flips `getShowGitFlowSection` to true and the section
materialises.

## Per-row context menu

Same menu as LOCAL branches (it's the same row component) — see
doc 10. Plus, on a `feature/*` branch you get extra menu entries
for "Finish feature" / "Publish feature" (which run the
corresponding `git flow feature finish/publish` commands). Those
extras are added by `popupRefMenu` when it detects the branch's
gitflow type from the prefix.

## chajá implementation hint

- New backend op needed: `read_gitflow_config(repo)` returning the
  prefixes and branch names from `.git/config`. Trivial via gix's
  config API.
- The init flow needs a modal — out of scope for the LeftPanel
  research doc, but implementing it is what makes the "+" button
  useful before init.
- Reuse the `organizeRefsIntoFolders` helper and the
  `RefWithDragAndDrop` row component. Don't make a new gitflow row
  type; it's just LOCAL refs in disguise.
- Per-branch gitflow operations (`finish feature`, `publish hotfix`,
  etc.) are scriptable as plain git commands — gix or shell to
  `git flow` if installed. Gitflow CLI compatibility is worth
  preserving since most gitflow users already have the CLI tool.
- Skip gitflow in v1 if it's not on the immediate roadmap. It's a
  niche workflow and the section auto-hides when not configured —
  no harm leaving the dispatch table entry as a stub returning
  `null` for now.
