# Entry points — every dispatch site that opens Integrations

There is **one canonical action** for opening the tab:

```js
openPreferenceView(tabTypes.INTEGRATIONS, <integrationSubTabType>?)
```

defined at `bundle:128002`. The optional second arg pre-selects a
provider sub-tab (`GITHUB`, `GITLAB`, etc., from `bundle:119100`).

There's also a **telemetry-action enum** that records *why* the tab
was opened (`bundle:168207`):

```js
at.TargetBranchStatusAction = function(Ve) {
  return Ve.createPullRequest = "createPullRequest",
         Ve.openIntegrationPreferences = "openIntegrationPreferences",
         Ve.openMenu = "openMenu",
         Ve.openPreferences = "openPreferences",
         Ve.viewPullRequest = "viewPullRequest", Ve
}({});
```

Mirror this enum in chajá so analytics know which CTA the user
clicked. Not just for parity — for product debugging.

## Helper: `getIntegrationsSubTabTypeFromIntegrationName`

Most dispatch sites pass through this normaliser (referenced at
`bundle:82137`, `84406`, `124352`, `145281`, `188898`, `207018`,
`250605`, `296327`, etc.). Given an `integrationType` like `"github"`
or `"jiraCloud"`, returns the matching `integrationSubTabTypes` key
(`"GITHUB"` / `"JIRA_CLOUD"`). chajá must reimplement; the mapping
is just upper-snake-case.

## Dispatch site inventory

| # | Bundle line | Source | Sub-tab arg |
|---|-------------|--------|-------------|
| 1 | `bundle:49358` | unidentified UI | none |
| 2 | `bundle:50844` | onboarding flow (saga `spawn`) | provider arg `mn` |
| 3 | `bundle:82137` | **Repo Init: "Connect to service" dropdown** | provider arg |
| 4 | `bundle:84406` | **FocusView provider picker** ("connect this provider") | provider arg |
| 5 | `bundle:85735` | **`Error-NeedUpgradedPermissions` toast button** | provider |
| 6 | `bundle:85800` | **`showLoginToProviderToast`: refresh-integration button** | provider |
| 7 | `bundle:85859` | **`showRefreshTokenExpiredToast`: reconnect button** | provider |
| 8 | `bundle:124352` | **AddEditProject modal — "default to non-connected provider"** | provider |
| 9 | `bundle:145281` | **Conflict-detection popover: "Connect integration to open PRs"** | provider |
| 10 | `bundle:162663` | provider-iteration loop (login flows) | provider |
| 11 | `bundle:185769` | post-onboarding integration setup | provider |
| 12 | `bundle:188898` | unidentified provider connect handler | provider |
| 13 | `bundle:207018` | unidentified | provider |
| 14 | `bundle:211455` | **Clone-repo modal "Connect to service"** | provider |
| 15 | `bundle:246008` | **Issue-tracker no-tracker stub: "Pick a tracker"** | none (just `ISSUE_TRACKER`) |
| 16 | `bundle:250605` | unidentified credential flow | provider |
| 17 | `bundle:296327` | **PR slidey-panel "Authenticate"** (`openAuthenticationView`) | provider |
| 18 | `bundle:380088` | **NewTab `ConnectIntegrationsWidget` action** | none |

The non-trivial categories below.

## Preferences > Integrations tab itself

`bundle:119166`:

```js
[gn.INTEGRATIONS]: {
  label: "Integrations",
  icon: ["fas", "plug"]
}
```

The tab is one entry in `labelAndIconByTabType`. It uses a sub-menu
(declared at `bundle:119210`):

```js
at.tabTypesWithSubMenus = {
  [gn.INTEGRATIONS]: Rn,           // integrationSubTabTypes
  [gn.ORGANIZATION]: An
}
```

Two tabs in the whole Preferences view have sub-menus —
`INTEGRATIONS` and `ORGANIZATION` (out of scope, GK account).

The sub-menu entries themselves are merged from `hostingServiceInfo`
+ `integrationInfo` (`bundle:119220`):

```js
at.labelAndIconForIntegrationTabTypes = {
  ...mn(dn.hostingServiceInfo),
  ...mn(dn.integrationInfo)
}
```

So the sub-tabs the user sees are the union of "connectable" entries.

## Conflict-detection inline alert (`bundle:145281`)

When the user is about to push and the conflict-detection popover
fires, it renders a "Connect integration to open pull requests"
option **only if** the remote points at a known provider but the
provider is unconnected (`la && !ua && oa`):

```js
ya = useCallback(() => {
  la?.type && (
    Vr(openPreferenceView(tabTypes.INTEGRATIONS,
                          getIntegrationsSubTabTypeFromIntegrationName(la.type))),
    at(TargetBranchStatusAction.openIntegrationPreferences),
    ct(!1))
}, [Vr, la?.type, at, ct]);
```

`la` is the resolved hosting-service info object for the remote.
The CTA label is `ConflictDetection-Popover-ConnectIntegrationToOpenPullRequests`
(`bundle:145304`), templated with `la.label` and the localised plural
("Pull Requests" / "Merge Requests" — comes from
`la.pullRequest.labelPluralTranslation`).

Once connected, the same popover slot becomes either "Open a
[Pull Request|Merge Request] to <branch>" (`Ea`) or "View
[PR|MR] #N on <provider>" (`ba`) — see lines 145306-145320.

## PR slidey-panel "Authenticate" CTA (`bundle:296326`)

```js
openAuthenticationView: at => {
  Ve(openPreferenceView(tabTypes.INTEGRATIONS,
                        getIntegrationsSubTabTypeFromIntegrationName(at)));
  Ve(closePullRequestSlideyPanel())
}
```

Component `data-testid="hosting-service-not-connected"`
(`bundle:296339`). Used by the **create-pull-request slidey panel**
when the user opens it but the relevant remote's provider is
unconnected. Closes the panel on click and pivots straight to
Preferences with the right sub-tab pre-selected.

The displayed copy uses two i18n keys (`bundle:296335`):

- `RemoteForm-ConnectToService` — button label, templated with
  provider's `label`.
- `Services-ServiceNotConnected` — body explanation.

## Toast-driven entry points (`bundle:85700`–`85870`)

Three error toasts deep-link to Integrations:

| Toast saga | i18n key (button) | Bundle |
|------------|--------------------|--------|
| `showLoginToProviderToast` | `ErrorMessage-refreshIntegrationButton` | `85798` |
| (`Error-NeedUpgradedPermissions`) | `ErrorMessage-NeedUpgradedPermissionsButton` | `85733` |
| `showRefreshTokenExpiredToast` | `ErrorMessage-reconnectIntegrationButton` | `85857` |

All three: `dismissable: lr.X_ONLY`, `duration: lr.TOAST_DURATION_FOREVER`
— the user has to click through, no auto-dismiss. Mirror that. See
`08-error-states.md`.

## Conflict-detection saga (`bundle:165515`)

Note the metric distinction: `openConflictDetectionPreferenceView`
opens the **Conflict Detection** preferences tab (not Integrations)
but uses the same `openPreferenceView` action with three different
metric subtypes (`bundle:165522-165544`):

```js
mn.automaticConflictDetectionAction.openPreferences
mn.TargetBranchStatusAction.openPreferences
mn.RemoteConflictDetectionAction.openPreferences
```

Don't confuse "open conflict detection prefs" with "open integration
prefs" — they're different tabs but invoked from the same popover
based on which alert fired.

## NewTab `ConnectIntegrationsWidget` (`bundle:380082`)

The "first run" empty-tab welcome view shows up to 4 widgets, one
of which is `ConnectIntegrationsWidget` (`bundle:380082`–`380094`)
when the user has fewer than 3 connected integrations
(`bundle:99161`: `Ve.length < 3 && dn.push($n.NewTabWidgetOption.ConnectIntegrations)`).
Action just dispatches `openPreferenceView(tabTypes.INTEGRATIONS)`
(no sub-tab, lands on first one — `GITHUB`).

i18n keys (`bundle:380091`):
- `NewTabView-ConnectIntegrations-Action` — button text
- `NewTabView-ConnectIntegrations-Description` — body
- `NewTabView-ConnectIntegrations-Title` — header

## chajá deviation: telemetry enum

GK fires `recordMetric` on every Integrations dispatch
(`gn.recordMetric` at `bundle:165523` etc., paired with
`additionalPayload.action`). chajá doesn't have telemetry but
**still ship the `TargetBranchStatusAction`-style enum** as a typed
union — it's the source-of-truth for "which CTA was clicked", and
the call sites are clearer when they explicitly tag the reason.

## chajá note: deep-linking is mandatory

Every CTA passes the provider as the second arg so the user lands
**already on the right sub-tab**. Skipping this and just opening
"Integrations, GitHub by default" makes the Connect button feel
disconnected from the action that triggered it. Bake the
sub-tab arg into the SolidJS router params from day 1.
