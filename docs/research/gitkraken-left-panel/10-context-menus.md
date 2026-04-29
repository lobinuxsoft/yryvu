# Context menus inside the LeftPanel

This doc enumerates every popup menu that GK shows when the user
right-clicks something inside the LeftPanel — the section header,
a row, a folder, a multi-selection. Each menu is built by a saga
in `/32578` (the `popup*Menu` family).

## The dispatcher (per-row right-click)

The LeftPanel's per-row right-click goes through `popupNodeMenu`,
which dispatches on `node.type`:

```js
popupNodeMenu = (node, sectionKey) => ({ saga: function*(d){
    switch (node.type) {
      case BRANCH_TYPE:    /* same as graph branch ref */
      case REMOTE_TYPE:    yield d.call(popupRemoteMenu, node, sectionKey); break;
      case TAG_TYPE:       yield d.call(popupTagMenu,    node, /*remoteNames*/, sectionKey); break;
      case STASH_NODE_TYPE: {
        const sel = yield select(getLeftPanelStashSectionSelectedShas);
        if (sel && size(sel) > 1 && includes(node.sha, sel))
          yield d.call(popupMultiSelectedStashesMenu, sel, sectionKey);
        else
          yield d.call(popupStashMenu, node.sha, sectionKey);
        break;
      }
      case WORKDIR_TYPE: { /* WIP "row" — opens uncommitted changes menu */ }
    }
});
```

Multi-select stash right-click swaps to the multi-select variant
*only when the right-clicked stash is part of the current
selection* — clicking a non-selected stash with right-button gives
you the single-stash menu (and clears the multi-selection). Same
logic for branches.

## Section-header menu (`popupLeftPanelSectionMenu`)

Right-click on any section header opens this menu. Menu structure
(from `/14834`, getLeftPanelSectionTranslateString builder):

```js
const buildSectionContextMenu = ({
   activeIssueTrackerType, expandedLeftPanelSections, hiddenLeftPanelSections,
   isLeftPanelCollapsed, leftPanelSectionValidity,
   localRefs, remotes, tagRefs, stashes,
   sectionKey, translate
}) => {
  const visibilityToggles = flow([
    filter(k => leftPanelSectionValidity[k]),
    map(k => ({
      telemetryId: "toggleHiddenLeftPanelSection",
      checked:    !includes(k, hiddenLeftPanelSections),
      enabled:    k !== LOCAL && k !== GITFLOW,           // LOCAL+GITFLOW always on
      label:      getLeftPanelSectionTranslateString(k, activeIssueTrackerType, translate),
      click:      () => dispatch(toggleHiddenLeftPanelSection(k)),
      type:       "checkbox",
    }))
  ])(ORDERED_LEFT_PANEL_HEADER_KEYS);

  const sectionSpecificEntries = [];
  const maximizeEntry          = [];
  if (sectionKey) {
    if (UNFILTERABLE_KEYS_HAVE_HIDE_ALL[sectionKey]) {
      const list = sectionKey === LOCAL    ? localRefs
                  : sectionKey === REMOTE  ? remotes
                  : sectionKey === STASHES ? stashes
                  : tagRefs;
      const hideKey = HIDE_ALL_KEY_BY_SECTION[sectionKey];   // "ContextMenu-LeftPanelHideAllLocalBranches" etc
      const showKey = SHOW_ALL_KEY_BY_SECTION[sectionKey];
      sectionSpecificEntries.push(
        { telemetryId:"hideAll", enabled:list.some(r => !r.isHidden),
          label:translate(hideKey),
          click:() => dispatch(setAllItemsVisibility(sectionKey, false)) },
        { telemetryId:"showAll", enabled:list.some(r =>  r.isHidden),
          label:translate(showKey),
          click:() => dispatch(setAllItemsVisibility(sectionKey, true)) },
      );
    }
    if (!isLeftPanelCollapsed)
      maximizeEntry.push({
        telemetryId:"maximizeSection",
        enabled: !(expandedLeftPanelSections.length === 1 &&
                   expandedLeftPanelSections[0] === sectionKey),
        label:translate("ContextMenu-LeftPanelMaximizeThisSection"),
        click:() => dispatch(collapseOtherLeftPanelSections(sectionKey)),
      });
  }
  return buildSeparatedMenu(
    [sectionSpecificEntries, maximizeEntry, visibilityToggles],
    /*telemetry*/);
};
```

The menu always has three groups (separated by dividers):

1. **Section-specific** — Hide all / Show all (only LOCAL, REMOTE,
   STASHES, TAGS).
2. **Maximize this section** — collapses every other section, expands
   this one full-height. Hidden when only this section is currently
   expanded.
3. **Per-section visibility checkboxes** — every valid section as a
   checkbox; LOCAL and GITFLOW are disabled (you can't hide them).

The "ContextMenu-LeftPanel\*" string set:

| Key | Label |
|-----|-------|
| `ContextMenu-LeftPanelLocal` | "Local Branches" |
| `ContextMenu-LeftPanelRemote` | "Remote Branches" |
| `ContextMenu-LeftPanelGitFlow` | "Git Flow" |
| `ContextMenu-LeftPanelTags` | "Tags" |
| `ContextMenu-LeftPanelStashes` | "Stashes" |
| `ContextMenu-LeftPanelWorktrees` | "Worktrees" |
| `ContextMenu-LeftPanelSubmodules` | "Submodules" |
| `ContextMenu-LeftPanelPullRequests` | "Pull Requests" |
| `ContextMenu-LeftPanelIssues` | "Issues" |
| `ContextMenu-LeftPanelGitHubIssues` / `…GitLabIssues` / `…JiraIssues` / `…Trello` | per-tracker label override |
| `ContextMenu-LeftPanelCloudPatches` | "Cloud Patches" — **SKIP** |
| `ContextMenu-LeftPanelTeams` | "Teams" — **SKIP** |
| `ContextMenu-LeftPanelHideAllLocalBranches` / `…Remotes` / `…Stashes` / `…Tags` | "Hide all X" |
| `ContextMenu-LeftPanelShowAllLocalBranches` / `…Remotes` / `…Stashes` / `…Tags` | "Show all X" |
| `ContextMenu-LeftPanelMaximizeThisSection` | "Maximise this section" |

## Per-row menus

| Row type | Builder | Notable entries |
|----------|---------|-----------------|
| `BRANCH` (LOCAL) | `popupRefMenu` → `buildBranchContextMenu` | Checkout, Merge, Rebase, Push/Pull, Reset, Rename, Delete, Set Upstream, Compare against working copy, Copy branch name, Pin to left, Push and start PR (per provider) |
| `BRANCH` (REMOTE) | same builder, branch type detected | Checkout (creates tracking branch), Merge, Rebase, Pull, Reset, Delete, Compare, Copy URL |
| `REPO` (REMOTE header) | `popupRemoteMenu` | Fetch, Edit remote, Remove remote, Fork on service, View in browser |
| `FOLDER` (LOCAL/REMOTE/TAGS/GITFLOW) | `popupLocalRefFolderMenu` | Hide N branches, Show N branches, Solo N branches, Stop soloing, Delete N branches in folder |
| Multi-select branches | `popupMultiSelectedRefsMenu` | Hide N, Show N, Solo N, Delete N local, Delete local AND remote, Cherry-pick N, Squash N, Pin N |
| `TAG` | `popupTagMenu` | Checkout tag, Create branch here, Annotate, Push to remote, Delete (local / from-remote-Y / from-all-remotes), Copy tag name, Merge into HEAD |
| `STASH` | `popupStashMenu` | Apply, Pop, Delete, Amend message, Export to Cloud Patch (**SKIP**) |
| Multi-select stashes | `popupMultiSelectedStashesMenu` | Delete N, Hide N, Show N |
| `WORKTREE` | `popupWorktreeMenu` | Switch to worktree, Create branch here, Lock/Unlock, Move, Remove |
| `SUBMODULE` | `popupSubmoduleMenu` | Initialize, Update, Reset, Commit, Open in tab, Open in file manager, Open in terminal, Copy path |
| `PULL_REQUEST` | `popupPullRequestBarMenu` | Open in browser, Copy URL, Checkout, Mark as draft / Ready, Close / Reopen, Refresh |
| `PULL_REQUEST_FILTER` | `popupPullRequestFilterMenu` | Edit filter, Move up / down, Remove, Refresh |
| `PULL_REQUEST_REPO` | (no menu — folder-style row) | — |
| `GITHUB_ISSUE` / `GITLAB_ISSUE` / `JIRA_ISSUE` | `popupIssueMenu` | Open in browser, Copy link, Create branch from (with gitflow variants), View card |
| `TRELLO_CARD` | same builder, Trello variants | View card in Trello, Open in browser, Copy link, Create branch from |
| `ISSUE_FILTER` | `popupIssueFilterMenu` | Edit, Move up / down, Remove |

## Common reusable entries

The bundle has a generic *commit menu* layer
(`popupCommitParentMenu`, `popupCopyTextMenu`, `popupRefCheckoutMenu`)
that's reused inside the row-specific menus:

| Reusable | Used by |
|----------|---------|
| Copy commit SHA | every row that has a `sha` |
| Copy ref name | branch / tag rows |
| Compare against working copy | branch / tag rows |
| Cherry-pick / Revert | commit rows + branch rows (operates on tip commit) |
| Reset to this commit (soft / mixed / hard, with hint label) | branch + tag rows |
| Pin to left / Unpin | branch rows (for the graph's pinned-branch lane) |

## Out-of-scope entries (proprietary)

These appear in the menus but require GK service:

- `ContextMenu-CopyDeepLinkForBranch` / `…ForCommit` / `…ForTag` /
  `…ForRemote` / `…OnRemote` (and the `Failed` variants) — these
  generate `gitkraken://...` URIs that re-open in the desktop GK
  client. **Skip.** chajá can implement its own `chaja://...` URI
  scheme later if the maintainers want.
- `ContextMenu-OpenGijLinkFor*` — "GitKraken in JetBrains" — opens
  the commit / file diff inside JetBrains IDEs via the GK service.
  **Skip.**
- `ContextMenu-ExplainBranchChangesPreview` — AI explain feature.
  **Skip.**
- `ContextMenu-ExportStashToCloudPatch` — uploads stash to GK
  Cloud. **Skip.**
- `ContextMenu-GenerateCommit*` — AI commit message generation.
  **Skip.**

## chajá implementation hint

- One menu builder per row type, mirroring GK's
  `popup{Branch,Remote,Tag,Stash,Worktree,Submodule,PR,Issue}Menu`
  shape. Each builder is a pure function `(row, repoCtx) => MenuItem[]`.
- The section-header menu is fully generic — one builder that
  takes `sectionKey + sectionState` and produces the same three
  groups. Don't copy it per-section; one shared builder is right.
- Multi-select detection (right-click on a selected row → multi
  menu) is a small but important affordance. Implement the
  multi-select-aware dispatcher early.
- Skip every "deep link" / "GIJ" / "AI explain" / "Cloud Patch"
  entry. The remaining menu is large enough.
- Accelerator labels (e.g. `Ctrl+Shift+M` for merge) appear in GK
  on Win/Linux but not all entries have shortcuts. Document the
  observed shortcuts in chajá's keybinding doc; don't invent new ones.
