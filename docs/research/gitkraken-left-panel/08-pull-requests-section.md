# PULL_REQUESTS section

PRs come from **provider APIs** (GitHub, GitHub Enterprise, GitLab,
GitLab self-hosted, Bitbucket Cloud, Bitbucket Server, Azure DevOps).
Implementing PRs in chajá needs a per-provider integration token
and a per-provider API client; **no GK service is required** for
the PR list itself.

The GK *service* layers add: cross-repo PR aggregation
(Workspaces), PR review-suggestion AI (out of scope), and Launchpad
(centralised PR dashboard, out of scope). The plain section below
is provider-API only.

## Show condition

```js
getShowPullRequestSection = createSelector(
  getAreIntegrationsLoading,
  getIsRepoUsingRemotesThatAreToAConnectedService,
  (isLoading, isConnected) => !isLoading && isConnected);
```

Show iff:

- Integrations are not currently being initialised, **and**
- At least one of the repo's remotes points at a service the user
  has connected (GitHub token, GitLab token, etc.).

A fresh repo with origin pointing at GitHub but no GitHub token
configured won't show the section — connect the integration first.

## Selectors (file `/91134`)

```js
filterPullRequests = (query, prs) => {
  const q = toLower(query);
  return flow(
    filter(pr => mapPrToDisplayName(pr).toLowerCase().indexOf(q) !== -1),
    reduce((acc, pr) => {
      const name = mapPrToDisplayName(pr);
      const i    = name.toLowerCase().indexOf(q);
      const pre  = name.substring(0, i);
      const hit  = name.substring(i, i + q.length);
      const post = name.substring(i + q.length);
      acc.list.push(pr);
      acc.namesToFuzzyStrings[name] =
        `${pre}${FUZZY_MATCH_PRE_DELIMITER}${hit}${FUZZY_MATCH_POST_DELIMITER}${post}`;
      return acc;
    }, {list: [], namesToFuzzyStrings: {}}))(prs);
};

mapPrToDisplayName = ({hostingServiceType, id, title}) =>
  `${getPullRequestCharacterFromType(hostingServiceType)}${id} ${title}`;
  // "#42 Fix the bug" for GitHub-style hosts; "!42" for GitLab.

getFilteredPullRequestsByRemote = createSelector(
  getPullRequestSearchText,                  // section-local search (NOT global filter)
  getPullRequestsByParentByRepoPath,
  getRepoPath,
  (query, allByRepo, repoPath) => {
    const byRemote = get([repoPath], allByRepo);
    return flow(
      toPairs,
      transform((acc, [remoteName, prs]) =>
        acc[remoteName] = filterPullRequests(query, prs),
      {})
    )(byRemote);
  });

getFilteredPullRequestsCount = createSelector(
  getFilteredPullRequestsByRemote,
  flow([values, sumBy("list.length")]));

getPullRequestHeaderProps = createSelector(
  getFilteredPullRequestsCount,
  getIsSectionExpandedByKey,
  getTranslationFn,
  (count, expanded, translate) => ({
    addButtonToolTip: translate("PullRequestBar-CreatePullRequest"),
    count,
    isExpanded: expanded[PULL_REQUESTS],
    translate,
  }));
```

PRs use a **per-section search box** (covered below), *not* the
global filter. `getPullRequestSearchText` is its own state slice
written by the search input.

## Row builder (PRs nested per remote, per filter)

```js
makePullRequestRows = createSelector(
  getAreIntegrationsLoading,
  getCollapsedPullRequestRemotes,
  getCollapsedPullRequestFilters,
  getHostingServiceTypesByRemoteName,
  getUserByIntegrationType,
  getImmutableRemoteData,
  getIsInUnsupportedRebase,
  getLeftPanelPullRequestSectionSelectedPullRequest,
  getFilteredPullRequestsByFilterId,            // grouped by filter
  getParsedUrlsByRemoteName,
  getPullRequestFiltersById,                    // user-defined filter definitions
  getPullRequestSearchText,
  getIsFetchingAllPullRequestsByRepoPath,
  getRepoPath,
  getWikiRepoMessageRow,                        // null or a "this is a wiki repo" message row
  getTranslationFn,
  (areLoading, collapsedRemotes, collapsedFilters, hostsByRemote, userByType,
   remoteData, isRebase, selectedPr, prsByFilter, urlsByRemote, filtersById,
   searchText, isFetchingAll, repoPath, wikiMsg, translate) => {
    if (wikiMsg) return [wikiMsg];               // wiki repos: just show the message, no PRs
    /* For each user-defined filter, build a "filter group" header row
       (PULL_REQUEST_FILTER) plus its child rows.
       Inside each filter, group PRs by base remote (PULL_REQUEST_REPO header rows
       collapsed via collapsedPullRequestRemotes), then PR rows themselves
       (PULL_REQUEST type). */
    const filterIds = keys(prsByFilter);
    const rows = transform((acc, filterId) => {
      const filter   = filtersById[filterId];
      const remoteIds= keys(prsByFilter[filterId]);
      // a filter row → expandable header
      acc.push(makePullRequestFilterRow({
        collapsedPullRequestFilters: collapsedFilters,
        count: …,
        fetchStatus: isFetchingAll ? IN_PROGRESS : null,
        key: filter.id, name: filter.name,
        pullRequestFilter: filter, repoPath,
        sectionKey: PULL_REQUESTS, type: PULL_REQUEST_FILTER,
      }));
      if (collapsedFilters.includes(filter.id)) return;
      // for each remote inside this filter, push a remote row + PR rows
      remoteIds.forEach(remoteName => {
        const {list, namesToFuzzyStrings} = filterPullRequests(searchText, prsByFilter[filterId][remoteName]);
        if (isEmpty(list)) return;
        acc.push(makePullRequestRepoRow(/*…*/));        // PULL_REQUEST_REPO
        if (collapsedRemotes.includes(`${remoteName}-${filter.id}`)) return;
        list.forEach(pr => acc.push(makePullRequestRow(pr, namesToFuzzyStrings, …)));
      });
    }, []);
    return rows;
  });
```

## Three row types (per PR section)

- **`PULL_REQUEST_FILTER`** — top-level group header (one per
  user-defined filter). Filter definitions are user-editable
  (covered by `PullRequestFilterSlideyPanel` below).
- **`PULL_REQUEST_REPO`** — per-base-remote sub-header. PRs are
  grouped by *base* remote (the target of the merge), not the head
  remote.
- **`PULL_REQUEST`** — actual PR row. Anatomy: provider icon, ID
  pill (`#42` GitHub-style, `!42` GitLab-style), title, status
  badge (open/closed/merged/draft), reviewer avatars, CI state.

Click handler:

```js
[PULL_REQUEST]: {
  clickHandler: ({pullRequest}) => ({ saga: function*(d){
      const {pullRequest} = arg;
      if (pullRequest) yield d.call(selectPullRequest, pullRequest,
                                    arg.filterIdOfPullRequest,
                                    {source: "leftPanel"});
  }})
}
```

Selecting a PR transitions the right panel to the PR review view
(out of scope for the LeftPanel doc; covered separately if chajá
implements PR review).

## The per-section search widget (`PullRequestFilterSlideyPanel`)

```js
<PullRequestSearchInput
   onChange       = {at => Ve(UiValueChanged("pullRequests.searchText", at.target.value))}
   onClear        = {() => Ve(UiValueChanged("pullRequests.searchText", ""))}
   onFilterCreate = {() => {
       Ve(PullRequestEditedFilterSet(null));
       Ve(PullRequestEditedFilterNameSet(""));
       Ve(PullRequestEditedFilterQuerySet(""));
       Ve(PullRequestFilterNameErrorSet(null));
       Ve(PullRequestFilterQueryErrorSet(null));
       Ve(openPullRequestFilterSlideyPanel());
   }} />
```

The search input is rendered as a row inside the section body
(see doc 02 — `PULL_REQUEST_SEARCH_HEIGHT = 35`). The "+" icon next
to the input opens a slide-in editor for **defining a new PR
filter** (`PullRequestFilterSlideyPanel`):

- **Name** (label shown in the panel)
- **Query** — provider-specific query DSL, e.g. for GitHub:
  `is:open author:@me`. The query is sent to the provider's search
  API as-is.
- Validation errors via `PullRequestFilterNameErrorSet` /
  `PullRequestFilterQueryErrorSet`.

Filter definitions are stored per repo in
`repoSettings.pullRequests.filters` (an array of `{id, name,
query}`). Reordering, editing, removing — all in the slidey panel.

Default filters that ship with GK (observed at runtime, derived
from `defaultFilters.json` in the bundle):

- "All PRs to this repo" — `is:pr`
- "My PRs" — `is:open author:@me`
- "PRs assigned to me" — `is:open assignee:@me`
- "PRs requesting my review" — `is:open review-requested:@me`

For GitLab the equivalent uses the GitLab merge-request query DSL.
For Azure DevOps, the dimensions are state/created-by/reviewer,
not a free-text DSL.

## Per-row context menu

```js
popupPullRequestBarMenu = (...) => /* opens a menu with: */
```

Menu entries (i18n keys observed in the bundle):

| Key | Action |
|-----|--------|
| `ContextMenu-StartPullRequestFromY` (header item) | open create-PR wizard |
| `ContextMenu-PushAndStartPullRequest` (on a branch row) | push current branch + open create-PR |
| `ContextMenu-PushAndStartPullRequestToRef` | push + open create-PR with a specific base |
| `ContextMenu-IssueViewIssueInGitHub` (on PR row) | open PR in browser |
| Copy PR URL | clipboard write of `web_url` |
| Checkout PR head (if same-fork) | `git checkout <head_ref>` |
| Checkout PR head as new branch (if cross-fork) | adds remote + `git checkout -b` |
| Mark as draft / Ready for review | provider API call |
| Close / Reopen | provider API call |
| Refresh PR list | re-fetch PRs |

Filter-row context menu (`popupPullRequestFilterMenu`):

| Key | Action |
|-----|--------|
| Edit filter | re-open slidey panel with this filter loaded |
| Move up / Move down | reorder filters |
| Remove filter | drop from `repoSettings.pullRequests.filters` |
| Refresh | re-fetch |

## Provider API call examples (NOT GK service)

| Provider | List PRs | Search PRs |
|----------|----------|------------|
| GitHub  | `GET https://api.github.com/repos/{owner}/{repo}/pulls?state=all` | `GET https://api.github.com/search/issues?q={query}+is:pr+repo:{owner}/{repo}` |
| GitHub Enterprise | same path against `https://{host}/api/v3` | same |
| GitLab Cloud | `GET https://gitlab.com/api/v4/projects/{id}/merge_requests` | `GET .../merge_requests?search={query}` |
| GitLab self-hosted | same against `https://{host}/api/v4` | same |
| Bitbucket Cloud | `GET https://api.bitbucket.org/2.0/repositories/{ws}/{repo}/pullrequests` | server-side query string |
| Bitbucket Server | `GET https://{host}/rest/api/1.0/projects/{key}/repos/{slug}/pull-requests` | client-side filter |
| Azure DevOps | `GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{id}/pullrequests` | server-side filter via querystring |

All of these are normal provider REST APIs — chajá can call them
directly with the user's stored token. No `gitkraken.com/api/...`
endpoints are involved.

## chajá implementation hint

- Build a per-provider client trait in Rust:
  `trait PullRequestProvider { fn list_prs(&self, repo) -> …; fn
  search_prs(&self, query) -> …; fn checkout_pr(&self, pr) -> …; }`.
  One impl per provider. Hide the stored access token behind a
  keyring service.
- The PR-section search and filter-definition editor are non-trivial
  UI surfaces. v1 can ship with the four default filters hard-coded
  and *no* user-editable filter management — the slidey-panel can
  come later.
- Cache PR lists aggressively (1-5 min TTL) — provider rate limits
  are real. GitHub gives 5000/hr authenticated, GitLab unauthenticated
  is 10/min so a token is mandatory for it.
- Skip the GK `Workspaces` cross-repo PR aggregation. PRs in chajá
  are always per-repo, viewed inside the open repo's tab. Workspace
  semantics need a multi-repo concept that doesn't exist in chajá's
  current model.
- `selectPullRequest` transitions the right panel into PR review.
  The right panel's PR view is its own surface (own diff layout,
  own comment threading). v1 chajá can open the PR in the browser
  via the row's "View in browser" menu and skip in-app review.
