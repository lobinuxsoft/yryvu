# ISSUES section

Same shape as PULL_REQUESTS: per-provider integration, per-section
search, user-defined filters. The factory dispatches on
`activeIssueTrackerType` to pick which sub-section to render.

## Show condition

```js
getShowIssueTrackerSection = createSelector(
  getActiveIssueTrackerType,
  trackerType => !trackerType || trackerType !== issueTrackerNoneType);
```

Always show the section, but render an "Issue Tracker Settings" stub
inside it when no tracker is connected (or when the user explicitly
picked `none`). Once a tracker is connected, the section becomes
provider-aware.

## Per-tracker dispatch (file `/58805`)

```js
const Ur = createSelector(
  getActiveIssueTrackerType,
  getIssueTrackerSettingsSection,                // settings stub when none active
  makeGitLabSection,                             // file /56687
  makeJiraSection,                               // file /5664
  makeTrelloSection,                             // file /52730
  makeGitHubIssuesSection,                       // file /9491
  (activeType, settings, gitlab, jira, trello, github) => {
    if (!activeType) return settings;
    switch (activeType) {
      case GITHUB:
      case GITHUB_ENTERPRISE:    return github;
      case GITLAB_SELF_HOSTED:
      case GITLAB:               return gitlab;
      case JIRA_SERVER:
      case JIRA_CLOUD:           return jira;
      case TRELLO:               return trello;
      default:                   return null;
    }
  });
```

Five tracker types (`getActiveIssueTrackerType` returns one):

- `github` (and `github_enterprise`)
- `gitlab` (and `gitlab_self_hosted`)
- `jira_cloud` (and `jira_server`)
- `trello`
- `none`

GK supports more (Azure DevOps Boards, Linear, etc.) in newer
versions, but 12.0.1 has these four families. **All four are pure
provider APIs** — no GK service calls in any of the issue lists.

## The "no tracker connected" state (settings stub)

```js
gr = createSelector(
  getShouldShowIssueTrackerSettingsForm,
  hr,                                            // header props
  () => createElement(CollapsedIssueTrackerSettingsHeader, null),
  getSupportedIssueTrackerTypes,
  (shouldShow, headerProps, collapsed, supported) =>
    shouldShow
      ? getLeftPanelSection(IssueTrackerSettingsHeader, HEADER_HEIGHT,
          headerProps,
          [{
            contentComponent: IssueTrackerSettingsForm,
            height: getRowOverrideHeight("ISSUE-TRACKER-SETTINGS", supported),
            props: { isLeftPanel: true, key: "ISSUE-TRACKER-SETTINGS" },
          }],
          collapsed, ISSUES)
      : null);
```

The settings stub shows a one-row form: "Pick a tracker:
[GitHub | GitLab | Jira | Trello]". Selecting one launches
the OAuth/PAT flow for that tracker. Once connected, the section
re-renders with that tracker's filters and issues.

## Issue rows

Per-tracker, but they share a structure (built by per-tracker
factories in `makeJiraSection` / `makeGitHubIssuesSection` etc.):

- **`ISSUE_FILTER`** — top-level group header (one per
  user-defined filter).
- Per-issue row: `GITHUB_ISSUE`, `GITLAB_ISSUE`, `JIRA_ISSUE`, or
  `TRELLO_CARD`. Each has its own `clickHandler` (see below).

Click handlers (file `/14834`):

```js
makeIssueClickHandlers = (Ve) => ({
  clickHandler: at => ({ saga: function*(d){
      const { filterIdOfIssue } = at;
      const issue = at[Ve];                 // "githubIssue" | "gitlabIssue" | "jiraIssue" | "trelloCard"
      if (issue) yield d.call(selectIssue, filterIdOfIssue, issue);
  }})
});

[GITHUB_ISSUE]: makeIssueClickHandlers("githubIssue"),
[GITLAB_ISSUE]: makeIssueClickHandlers("gitlabIssue"),
[JIRA_ISSUE]:   makeIssueClickHandlers("jiraIssue"),
[TRELLO_CARD]:  makeIssueClickHandlers("trelloCard"),
```

Click → `selectIssue(filterId, issue)` → opens the issue view in
the right panel (own surface, out of scope for this doc — chajá
v1 can open in browser instead).

## Filter management (per tracker)

```js
[ISSUE_FILTER]: {
  clickHandler: ({ issueFilter, issueTrackerType, collapsedIssueFilters }) => ({
      locks: [REPO_SETTINGS],
      saga: function*(d){
          yield call(setLeftPanelSelection, null);
          const next = yield call(toggleElement, issueFilter.id, collapsedIssueFilters);
          yield d.call(setRepoSetting,
                       ["issues", issueTrackerType, "collapsedFilters"],
                       next, repoPath);
      }
  })
}
```

Per-tracker collapsed-filter state is stored at
`repoSettings.issues.<trackerType>.collapsedFilters`. Filter
*definitions* are stored separately at
`repoSettings.issues.<trackerType>.filters`.

Default filters per tracker (observed at runtime):

| Tracker | Default filters |
|---------|-----------------|
| GitHub  | "Open issues", "Created by me", "Assigned to me", "Mentioning me" |
| GitLab  | same shape |
| Jira    | "My open issues", "All my open issues across projects", "Recent activity" |
| Trello  | per board (the boards themselves are the filters) |

## Per-section search (`IssueTrackerSearch`)

Inserted as a non-hideable row at the top of the section body
(`ISSUE_TRACKER_SEARCH_HEIGHT = 35`). The search input writes to
`issueTracker.searchText` and the per-tracker selectors filter
their issue lists by the search text.

The search text is used differently per tracker:

- **GitHub**: the GitHub search query DSL is supported
  (`is:open assignee:@me`).
- **Jira**: client-side substring match on issue title; server-side
  JQL is *not* used here (JQL is reserved for filter definitions).
- **GitLab**: client-side substring match.
- **Trello**: client-side substring match on card title.

## Provider API call examples

| Tracker | List | Search |
|---------|------|--------|
| GitHub | `GET https://api.github.com/repos/{owner}/{repo}/issues?state=open` | `GET https://api.github.com/search/issues?q={query}+repo:{owner}/{repo}` |
| GitHub Enterprise | as GitHub against `https://{host}/api/v3` | same |
| GitLab Cloud | `GET https://gitlab.com/api/v4/projects/{id}/issues` | server-side `?search={query}` |
| GitLab self-hosted | same against `https://{host}/api/v4` | same |
| Jira Cloud | `POST https://{site}.atlassian.net/rest/api/3/search` (JQL body) | JQL filter |
| Jira Server | `POST https://{host}/rest/api/2/search` (JQL body) | JQL filter |
| Trello | `GET https://api.trello.com/1/boards/{id}/cards` (key+token query) | client-side |

All provider API calls. **No `gitkraken.com/api/...`** endpoints
are touched for the issue list.

## Per-row context menu

Menu entries vary by tracker but share a common spine
(i18n keys observed):

| Key | Action |
|-----|--------|
| `ContextMenu-IssueViewIssueInGitHub` / `…InGitLab` / `…InJira` | open in browser |
| `ContextMenu-IssueViewIssueX` / `…XInBrowser` | same with issue title in label |
| `ContextMenu-IssueCopyIssueLink` | clipboard write of `web_url` |
| `ContextMenu-IssueCopyCardLink` (Trello-specific) | clipboard write |
| `ContextMenu-IssueCheckoutBranchFrom` | opens "Create branch from issue" with prefilled name |
| `ContextMenu-IssueCreateBranchGitFlowFeature` (when gitflow enabled) | `git flow feature start <issue-id>-<slug>` |
| `ContextMenu-IssueCreateBranchGitFlowHotfix` | `git flow hotfix start <issue-id>` |
| `ContextMenu-IssueCreateBranchGitFlowRelease` | `git flow release start <issue-id>` |
| `ContextMenu-IssueViewCardX` / `…XInBrowser` (Trello) | open card |
| `ContextMenu-IssueViewCardInTrello` | same |

The "Create branch from issue" entries are interesting: they
prepopulate the branch-name dialog with `{issue-id}-{slugified-title}`,
which is a nice UX touch worth preserving.

The filter-row context menu (`popupIssueFilterMenu`):

| Key | Action |
|-----|--------|
| `ContextMenu-IssueTrackerFilterEditFilter` | open filter editor |
| `ContextMenu-IssueTrackerFilterMoveUp` / `…MoveDown` | reorder |
| `ContextMenu-IssueTrackerFilterRemoveFilter` | drop from settings |

## chajá implementation hint

- Mirror the per-provider trait approach from PRs:
  `trait IssueTracker { fn list(&self, repo) -> …; fn
  search(&self, q) -> …; fn open(&self, id) -> …; }`. One impl
  per tracker.
- Skip Trello in v1 unless explicitly demanded — Trello as an
  issue tracker is rare in dev workflows and the API is unique
  enough that maintenance cost is real.
- The "no tracker connected" settings stub is a useful
  onboarding affordance — implement it as a single row that
  triggers the connection wizard. Don't hide the section
  entirely.
- v1 ISSUES section can ship with **just GitHub** plus the
  settings stub — it covers the majority case and gates the
  per-tracker complexity behind one provider's API.
- The "Create branch from issue" actions are pure git plus
  string templating. Implement as a small helper:
  `make_branch_name_from_issue(issue) -> "issue-42-fix-the-bug"`.
- Cache issue lists same as PRs (1-5 min TTL). For Jira in
  particular, JQL queries are expensive and the user reissues
  them on every search keystroke — debounce 500 ms minimum.
