# Connection management — Preferences > Integrations

The list view inside Preferences > Integrations. One sub-tab per
integration, each rendering a connection-form component (the
"account row" UI plus connect/disconnect controls).

## The reusable connection-form component (`bundle:165616`)

Class component (no name in bundle, internal `Dr extends Component`).
Renders the "auth-content" panel inside each provider's sub-tab.

Props (consumed at `bundle:165619`–`165632`):

| Prop | Source |
|------|--------|
| `connectedIntegrations` | `getCredentialsByIntegrationType(state)` |
| `hasInvalidSSLCert` | `!isEmpty(getInvalidSSLCertsByIntegrationType(state)[type])` |
| `integrationType` | passed in by parent |
| `hideConnectionStatus` | parent override (used in onboarding flow) |
| `hideDisconnectButton` | parent override |
| `isConnecting` | `getIsConnectingByIntegrationType(state)[type]` |
| `isUsingSSLBypass` | `getIsUsingSSLBypassByIntegrationType(state)[type]` |
| `userByIntegrationType` | `getUserByIntegrationType(state)` |
| `useAuthorInitialsForAvatars` | UI preference |

Action props (`bundle:165718`–`165733`):

| Action | Dispatches |
|--------|------------|
| `onConnect` | `sendAuthorizationRequest(type)` |
| `onDisconnect` | `disconnectIntegration(type)` |
| `onProceedWithInvalidCert` | `addToSSLWhitelist(host, cert)` |
| `openUrl` | `openExternal(url)` |

## The visible anatomy of an account row

DOM structure (`bundle:165699`–`165705`):

```
<div className="auth-content">
  {Ea ← SSL warning banner if invalid cert OR using bypass}
  <div className="account-row">
    <div className="account-info well">
      {aa ← user info (avatar + name + username) OR placeholder icon}
      {ha ← connection-status pill ("Connected" / "Not Connected" / "Connecting...")}
      <ButtonToolbar>
        {ta ← Connect / Refresh button (success-styled, xsmall)}
        {na ← Disconnect button (danger-styled, xsmall) — only when connected}
      </ButtonToolbar>
    </div>
  </div>
  {ma ← connecting-spinner overlay component}
  {ya ← per-host SSO/enterprise auth-section component when connected}
  {ba ← Jira-Cloud-only "accessible resources" picker}
</div>
```

## Connection-status pill (`bundle:165670`–`165682`)

Three states encoded as `(class, icon, label)` triples:

| State | className | Icon | Label key |
|-------|-----------|------|-----------|
| disconnected | `color-red fs-4` | `["far", "ban"]` | `Services-NotConnected` |
| connected | `color-green fs-4` | `["fas", "check-circle"]` | `Services-Connected` |
| connecting | `color-orange fs-4` | `["far", "circle-notch"]` (spinning) | `ConnectingWithEllipsis` |

`data-testid="integration-connection-status"` (`bundle:165677`).

## User-info block (`bundle:165650`–`165669`)

When connected (`Vr` = user object exists):

```
<div className="user-info">
  {avatar OR FontAwesome user-circle if no avatarUrl OR useAuthorInitialsForAvatars}
  <span className="user">
    <div className="name">{Vr.displayName}</div>
    <div className="username">{Vr.login}</div>
  </span>
</div>
```

When disconnected: just a placeholder `<FontAwesomeIcon icon=["fal","user-circle"] size="3x" />`.

Avatar component is `Rn.default` (size 40, `url={Vr.avatarUrl}`).

## Connect button (`bundle:165635`–`165643`)

Rendered when **not connected** OR when `integrationType === JIRA_CLOUD`
(JC always shows the button because it can have multiple sites and
re-connecting adds a site).

```
<Button bsSize="xsmall" bsStyle="success"
        data-testid="connect-integration-button"
        onMouseDown={convertOnClickToOnMouseDown(onConnect)}>
  {connected ? translate("RemoteForm-RefreshButtonTooltip")
             : translate("RemoteForm-ConnectToService", friendlyName)}
</Button>
```

Note `onMouseDown` not `onClick` — `convertOnClickToOnMouseDown`
(`bundle:165641`) is a perf hack to start auth slightly earlier.
Mirror this in chajá; it's user-perceptible on slow systems.

## Disconnect button (`bundle:165644`–`165648`)

Only rendered when connected and `!hideDisconnectButton`:

```
<Button bsSize="xsmall" bsStyle="danger"
        onMouseDown={convertOnClickToOnMouseDown(onDisconnect)}>
  {translate("Services-Disconnect")}
</Button>
```

i18n key: `Services-Disconnect`.

## Hosting-service-extras widget (`bundle:165687`)

When `integrationType` is a hosting service AND connected AND no
SSL issues, an extras component (`Nr.default`,
`hostingServiceType={ga}` prop) is rendered below the account row.
This is the surface where SSH-key management, default-branch picker,
and similar per-host tools live (out of scope for this doc — covered
in repo-management research).

## Jira-Cloud accessible-resources picker (`bundle:165698`)

```
ba = ct === Dn.issueTrackerTypes.JIRA_CLOUD
  && createElement(hr.default, null);
```

Only Jira Cloud renders this — it's a list of "Atlassian sites the
authenticated user can access", populated via the
`FETCH_JIRA_CLOUD_ACCESSIBLE_RESOURCES` IPC (`bundle:166983`). User
picks one site to bind this connection to.

## SSL-cert warning panel (`bundle:165690`)

```
Ea = (at || jn) && createElement(gr.default, {
  integrationType: ct,
  isUsingSSLBypass: jn,
  onDisconnectFromIntegration: $n,
  onProceedWithInvalidCert: er,
  openUrl: dr,
  translate: ur
});
```

Renders when the cached cert for the host is invalid OR the user
has the SSL-bypass toggle on. The panel offers "Proceed with
invalid cert" (writes to `addToSSLWhitelist` in the user's profile)
or "Disconnect".

## State selectors (`bundle:203583`–`203626`)

The exports list (one of many bundle-spread setters):

```
at.getAreIntegrationsLoading
at.getCredentialsByIntegrationType
at.getCredentialsByProfileGuid
at.getConnectedIntegrationTypes
at.getConfiguredIntegrationTypes
at.getConfiguredIntegrationTypesByProfileGuid
at.getCustomIntegrationConfigsByType
at.getETags
at.getHasConnectedIntegrationByType
at.getHostnamesByIntegrationType
at.getHostnamesWithoutPortByIntegrationType
at.getIntegrationAccessTokenMetadata
at.getIntegrationAccessTokenMetadataForCurrentProfile
at.getIntegrationConfigurations
at.getIntegrationConfigurationsByProfileGuid
at.getIntegrationInfoEnabledOnThisClient
at.getIntegrationSelfHostedVersionByType
at.getInvalidSSLCertByHostname
at.getInvalidSSLCertsByIntegrationType
at.getIsConnectedByIntegrationType
at.getIsFetchingAzureAccountInfoByAzureProjectId
at.getIsRepoSetupInProgressByRepoPathWithDotGit
at.getIsUnsupportedSelfHostedVersionByType
at.getIsUserFetchingByIntegrationType
at.getIsUsingSSLBypassByIntegrationType
at.getProviderApiAccountInfoByIntegrationType
at.getProviderApiBasicInput
at.getProviderApiOptionsByIntegrationType
at.getRefreshDataSucceededByIntegrationType
at.getUserByIntegrationType
```

Verbatim:

- `getCredentialsByIntegrationType` (`bundle:203622`):
  ```js
  hr = createSelector(ur, getCurrentProfileGuid, (Ve, at) => Ve[at] ?? {});
  ```
  — credentials are **per-profile** (multi-profile support). Each
  profile has its own integration table.

- `getUserByIntegrationType` (`bundle:203626`):
  ```js
  at.getUserByIntegrationType = Ve => Ve.integration.userByIntegrationType;
  ```
  — separately tracked from credentials. Hydrated by `GET_USER` IPC
  (`bundle:166966`) after first connect.

## Multiple identities per provider

Bundle clue: `connectedIntegrations: Ve` is a *map* keyed by integration
type, but each value is the credential object — only one identity
per provider per profile. **GK does NOT support multiple identities
on the same provider in a single profile.**

> ⚠ unconfirmed — There is no UI affordance in the bundle for
> "Switch GitHub account". To use multiple GitHub accounts, GK
> users create multiple **profiles** (`getCurrentProfileGuid` is
> the keying primitive). Profiles are GK's solution to the
> multi-identity problem.

chajá note: cloning this means profile-scoped credential storage
from day 1. Don't bake "global integration tokens" into chajá's
schema — that's a refactor disaster the day someone asks for two
GitHub accounts.

## Refresh affordance

Connect button doubles as Refresh when already connected
(`bundle:165636`):

```js
const Ve = Zr ? ur("RemoteForm-RefreshButtonTooltip")
              : ur("RemoteForm-ConnectToService", Xr);
```

Clicking re-fires `sendAuthorizationRequest(type)` which re-runs
the OAuth dance (or re-prompts for a new PAT). i18n: button label
just says "Connect" / "Refresh"; tooltip is
`RemoteForm-RefreshButtonTooltip`.

There's no separate "Refresh data" button in the connection panel
itself — that's the per-section action ("Refresh PR list", etc.)
in the LeftPanel section context menus, not Preferences.

## Persistence

Connection state lives in two places:

| Store | Key | Content |
|-------|-----|---------|
| Redux (in-memory) | `state.integration.userByIntegrationType` | `{[type]: { id, login, displayName, avatarUrl, … }}` |
| Profile credentials (encrypted on disk, see doc 06) | `<profile>.<integrationType>` | `{ accessToken, refreshToken?, expiresAt?, … }` |

The Redux state is hydrated on app start by reading the credential
store and firing `GET_USER` for each connected integration to
populate the user info. **Don't** persist the user object
separately — re-fetch on launch via the API. Keeps stale avatars
fresh.

## chajá deviation: SolidJS components, not React class

The whole connect-form component lives in one file. SolidJS port
notes:

- `class extends Component` → SolidJS function component with
  `props` destructure
- `connect(mapState, mapDispatch)` → `useStore` / `useDispatch`
  hooks pattern
- `convertOnClickToOnMouseDown` → use `onMouseDown` directly in
  Solid; no need for the wrapper
- The whole `account-row` block in one file is fine — it's <200
  LOC and self-contained. Don't split the connection-status pill
  into its own file unless reused.

## chajá note: testid attributes are load-bearing

`data-testid="connect-integration-button"`,
`data-testid="integration-connection-status"`,
`data-testid="hosting-service-not-connected"`. Mirror these
verbatim in chajá's components — they let chajá ship Playwright/Vitest
e2e tests that have a chance of surviving GK upstream changes (in
case GK ever open-sources, or chajá ever cross-references).
