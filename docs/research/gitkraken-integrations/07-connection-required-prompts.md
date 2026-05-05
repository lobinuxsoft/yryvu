# Connection-required inline prompts

Surfaces that need an integration but find none. Each renders a
provider-aware CTA that deep-links into Preferences > Integrations
with the right sub-tab pre-selected.

## The selector that gates "Show PR section" (`bundle:167211`)

Recap from the LeftPanel audit:

```js
at.getIsRepoUsingRemotesThatAreToAConnectedService =
  createSelector(
    getConnectedHostingServiceTypesForRepo,
    some(Boolean));
```

Returns true iff at least one of the repo's remotes points at a
hosting service the user has currently connected. The PR
LeftPanel section's `getShowPullRequestSection` consumes this. When
false, the PR section disappears entirely — there's no "ghost
section" with a Connect CTA in the LeftPanel.

> chajá deviation: this is a UX trade-off. GK hides the PR section
> until you connect; the discoverability cost is paid by the
> *other* CTAs below. Mirror exactly.

## CTA #1 — PR slidey-panel "Connect" empty state (`bundle:296329`)

When the user clicks "Create Pull Request" (e.g. via "Push and
Create PR" or any other dispatch site) and the relevant remote's
provider is unconnected, the slidey panel renders a
`hosting-service-not-connected` view instead of the PR-create form.

DOM (`bundle:296337`):

```
<div className="hosting-service-not-connected"
     data-testid="hosting-service-not-connected">
  ...
</div>
```

Text content via i18n:

- `RemoteForm-ConnectToService` — button label, templated with the
  provider's `label`
- `Services-ServiceNotConnected` — body explanation

Click handler (`bundle:296326`):

```js
openAuthenticationView: at => {
  Ve(openPreferenceView(tabTypes.INTEGRATIONS,
                        getIntegrationsSubTabTypeFromIntegrationName(at)));
  Ve(closePullRequestSlideyPanel())
}
```

Closes the slidey panel and opens Preferences > Integrations sub-tab
for the right provider.

## CTA #2 — Issue-tracker no-tracker stub (`bundle:246008`)

Inside the LeftPanel's ISSUES section, when no tracker is connected,
the section renders a one-row settings form (covered by the
`gitkraken-left-panel/09-issues-section.md` audit). Click handler
on its action:

```js
onClick: () => Ve(openPreferenceView(dr.tabTypes.ISSUE_TRACKER))
```

Note the sub-tab here is `ISSUE_TRACKER` (singular), **not**
`INTEGRATIONS`. This is GK's separate "Issue Tracker" preferences
tab (`bundle:119170`):

```js
[gn.ISSUE_TRACKER]: {
  label: "IssueTracker",
  icon: ["fas", "tasks"]
}
```

It's a dedicated tab with a tracker-type picker. Once the user
picks a tracker, the OS-keychain auth flow is the same, but the
landing UI differs.

> ⚠ unconfirmed — Why two tabs (`INTEGRATIONS` and `ISSUE_TRACKER`)?
> Likely historical — `ISSUE_TRACKER` predates `INTEGRATIONS` and
> survives for backwards compatibility. **chajá rec:** unify into
> one `INTEGRATIONS` tab. Don't replicate the GK split — it's
> confusing UX (two places to connect Jira: the issue-tracker tab
> and the integrations tab).

## CTA #3 — "Push and Create PR" button gating

The Push toolbar dropdown contains a `PushAndStartPullRequest` action
(referenced in `gitkraken-left-panel/08-pull-requests-section.md`).
When the remote's provider is unconnected, the menu entry's
disabled-tooltip surfaces a connect CTA.

> ⚠ unconfirmed — Exact disabled-state copy not found in single
> grep. Pattern observed in conflict-detection popover
> (`bundle:145304`):
> `ConflictDetection-Popover-ConnectIntegrationToOpenPullRequests` —
> templated with `la.label` and `la.pullRequest.labelPluralTranslation`.
> The push-button likely uses a similar template.

## CTA #4 — Conflict-detection popover (`bundle:145281`)

Already covered in `01-entry-points.md`. The "Connect integration to
open Pull Requests" option appears as a menu entry inside the
conflict-detection popover when the relevant remote's provider is
unconnected. Clicking dispatches into Preferences with the right
sub-tab and fires
`TargetBranchStatusAction.openIntegrationPreferences`.

## CTA #5 — Add-Edit Project modal "default-to-not-connected" handler (`bundle:124351`)

Workspaces feature (out of scope, but the handler is reusable):

```js
onDefaultSelectNotConnectedProvider: at => {
  Ve(openPreferenceView(hr.tabTypes.INTEGRATIONS,
                        getIntegrationsSubTabTypeFromIntegrationName(at)))
}
```

When the user picks a project location whose provider isn't connected,
the modal proxies into Preferences. **Out of scope for chajá** (no
Workspaces) but the handler shape is reused in chajá's clone-repo
modal.

## CTA #6 — Clone-repo modal "Connect to service" (`bundle:211454`)

```js
onClickConnectToService: at => {
  Ve(openPreferenceView(ur.tabTypes.INTEGRATIONS, at))
}
```

The clone-repo modal lets users browse their connected providers'
repos. If the picked provider isn't connected, this CTA fires.
chajá v1 has clone-by-URL only (so this CTA doesn't apply yet) but
v2's "browse my GitHub repos" feature reuses the same plumbing.

## CTA #7 — Repo Init "Connect to service" (`bundle:82136`)

Similar to clone — when initialising a new repo with intent to push
to a provider, the form has a "Connect" button that opens
Preferences. Only relevant once chajá has remote-creation flows.

## CTA #8 — FocusView provider picker (`bundle:84405`)

```js
onClickNonConnectedIntegration: at => {
  Ve(openPreferenceView(jn.tabTypes.INTEGRATIONS,
                        getIntegrationsSubTabTypeFromIntegrationName(at)))
}
```

In FocusView (Launchpad), the provider-filter dropdown lists every
provider, connected or not. Clicking a not-connected one opens
Preferences. **Out of scope for chajá** (no FocusView) but logged
for completeness.

## CTA #9 — NewTab `ConnectIntegrationsWidget` (`bundle:380082`)

Already covered in `01-entry-points.md`. The "first run" empty-tab
welcome view surfaces a generic CTA when fewer than 3 integrations
are connected. The widget body uses i18n:

- `NewTabView-ConnectIntegrations-Title`
- `NewTabView-ConnectIntegrations-Description`
- `NewTabView-ConnectIntegrations-Action`

## i18n key catalogue (CTAs)

| Key | Where |
|-----|-------|
| `RemoteForm-ConnectToService` | per-provider Connect button (templated) |
| `RemoteForm-RefreshButtonTooltip` | when already connected |
| `Services-Connected` / `Services-NotConnected` / `ConnectingWithEllipsis` | status pill |
| `Services-Disconnect` | Disconnect button |
| `Services-ServiceNotConnected` | inline empty-state body (templated) |
| `Workspace-IntegrationNotConnected` | tooltip variant for project rows |
| `IssueTracker-Connect` / `IssueTracker-Connected` | issue-tracker icon tooltip |
| `ConflictDetection-Popover-ConnectIntegrationToOpenPullRequests` | popover menu item |
| `NewTabView-ConnectIntegrations-{Title,Description,Action}` | NewTab widget |
| `Promote-ConnectIntegrationLink` | from PromptForCreds dialog |

## chajá note: deep-link must include sub-tab

Every single CTA above passes a sub-tab arg. Make Preferences >
Integrations a SolidJS route with required `provider` param so it's
impossible to forget:

```
/prefs/integrations/:provider
```

…and have the CTAs build the URL programmatically. Don't make the
sub-tab an in-component derived state from a query param; that's
the kind of thing where, six months in, someone navigates without
the param and lands on a confusing "GitHub by default" tab.
