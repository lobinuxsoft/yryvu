# Providers — the master table

The single source of truth is `integrationInfo` (`bundle:166355`–`166940`).
Each entry is a flat record with ~25 fields. This doc is a one-row-per-provider
distillation.

## Field reference (what each key means)

Selected from the GitHub.com entry (`bundle:166378`–`166438`) — same
fields recur across providers:

| Field | Meaning |
|-------|---------|
| `type` | identity key, used everywhere as `hostingServiceType` / `issueTrackerType` |
| `label` | short display name (e.g. `"GitHub"`) |
| `verboseLabel` | disambiguating display name (e.g. `"GitHub Enterprise Server"`) |
| `hostnameLabel` | what the user sees as the "service host" (e.g. `"GitHub.com"`) |
| `hostname` | literal hostname (`"github.com"`) or sentinel `dn.CUSTOM_HOSTNAME` (`"enterprise"`) for self-hosted |
| `roles` | array of `[HOSTING_SERVICE, mn (issueTracker), gn (login)]` — controls which sub-maps include this entry |
| `authType` | one of `OAUTH` / `PAT` / `USERNAME_AND_PASSWORD` |
| `authEndpointName` | path slug for the GK auth proxy (`"github"`, `"gitlab"`, …); see `03-oauth-flow.md` |
| `iconClassName` / `faIcon` | FontAwesome icon classes |
| `pullRequest.character` | `"#"` or `"!"` (GitLab uses `!` for MRs); used by `mapPrToDisplayName` |
| `pullRequest.supports*` | feature-gates per-provider (drafts, multipleAssignees, etc.) |
| `pullRequestViewSupported` | boolean — whether GK has an in-app PR review surface for it |
| `requiresPATForUserPassAuth` | when user types user/pass, treat as PAT (used for Bitbucket app-passwords) |
| `PATsAreCalledAppPasswords` | UI string only — Bitbucket calls them "app passwords" |
| `generateTokenPath` | relative path on provider host to the PAT-creation page (deep-linked from Connect dialog) |
| `oldGenerateTokenPath` | older path, used as fallback for older self-hosted versions |
| `generateTokenParams` | querystring appended to the PAT URL (`scopes=repo,admin:org,…`) |
| `requiresProToAuthenticate` | **GK paywall flag — chajá ignores** |
| `enabledInGitKrakenEnterprise` | **GK on-prem distribution — chajá ignores** |
| `minimumSupportedVersion` | for self-hosted entries, lowest API version GK guarantees |
| `isSelfHosted` | distinguishes `.com` vs on-prem variants |
| `alternateHostnamesForUrls` | URL detection — Azure has `["vs-ssh.visualstudio.com", "ssh.dev.azure.com", "dev.azure.com"]` (`bundle:166806`) |
| `gkProjects.apiProvider` | **GK Workspaces / Launchpad — chajá ignores** |
| `issuesAreTiedToOneRepo` | true for GitHub/GitLab; false for Jira/Trello/AzureBoards |
| `allowEmptyIssueFilterText` | whether the filter editor accepts an empty query DSL |
| `replaceAvatarsWithDefaultIcons` | flag for providers without avatar APIs |
| `supportsSSHModification` | whether GK can add SSH keys via API |
| `supportsUserRepos` | whether the provider exposes a "my repos" listing API |

## The 10 entries

### `github` (`bundle:166378`–`166438`)

```
hostname:                "github.com"
hostnameLabel:           "GitHub.com"
label / verboseLabel:    "GitHub" / "GitHub"
authType:                OAUTH
authEndpointName:        "github"
roles:                   [HOSTING_SERVICE, issueTracker, login]
faIcon:                  ["fab", "github"]
pullRequest.character:   "#"
pullRequest.supportsDrafts: true     ← only github + githubEnterprise have this true
requiresPATForUserPassAuth: true
issuesAreTiedToOneRepo:  true
pullRequestViewSupported: true
gkProjects.apiProvider:  "github"
```

API base URL: `bundle:46134` `baseUrl: "https://api.github.com"` (Octokit init).

Default browser host: `dt.GITHUB_DEFAULT_BROWSER_HOST` from `bundle:201700` (the
literal `"https://github.com"` lives in module `76530`, referenced at
`201700` of the integrations module).

### `githubEnterprise` (`bundle:166439`–`166501`)

```
hostname:                CUSTOM_HOSTNAME ("enterprise")
hostnameLabel:           "GitHub Enterprise Server"
label:                   "GitHub Enterprise Server"
authType:                PAT
generateTokenPath:       "/settings/tokens/new"
generateTokenParams:     "scopes=repo,admin:org,admin:public_key,workflow&description=GitKraken"
roles:                   [HOSTING_SERVICE, issueTracker]    (no login role)
minimumSupportedVersion: "2.20.0"
requiresProToAuthenticate: true       ← GK paywall, chajá ignores
pullRequest.supportsDrafts: false
pullRequestViewSupported: false       ← no in-app review for GH Enterprise
gkProjects.apiProvider:  "github_enterprise"
```

Note `roles` doesn't include the login role — you can't sign into
GK with GHE, only use it as a provider.

### `gitlab` (`bundle:166502`–`166567`)

```
hostname:                "gitlab.com"
hostnameLabel:           "GitLab.com"
label / verboseLabel:    "GitLab" / "GitLab"
authType:                OAUTH
authEndpointName:        "gitlab"
faIcon:                  ["fab", "gitlab"]
pullRequest.character:   "!"           ← MR convention
labelSingularTranslation: "MergeRequest"
labelPluralTranslation:   "MergeRequests"
visibilityLevelByAccessType: { PRIVATE:"private", PUBLIC:"public" }
roles:                   [HOSTING_SERVICE, issueTracker, login]
issuesAreTiedToOneRepo:  true
pullRequestViewSupported: false        ← no in-app MR review
```

Default host literal: `bundle:201655`
`at.GITLAB_DEFAULT_BROWSER_HOST = "https://gitlab.com"`.

### `gitlabSelfHosted` (`bundle:166568`–`166633`)

```
hostname:                CUSTOM_HOSTNAME
hostnameLabel:           "GitLab (Self-Managed)"
verboseLabel:            "GitLab Self-Managed"
authType:                PAT
generateTokenPath:       "/-/user_settings/personal_access_tokens"
oldGenerateTokenPath:    "/-/profile/personal_access_tokens"
minimumSupportedVersion: "13.4.0"
requiresProToAuthenticate: true        ← GK paywall, chajá ignores
roles:                   [HOSTING_SERVICE, issueTracker]
gkProjects.apiProvider:  "gitlab_self_hosted"
```

### `bitbucket` (`bundle:166634`–`166693`)

```
hostname:                "bitbucket.org"
hostnameLabel:           "Bitbucket.org"
label / verboseLabel:    "Bitbucket"
authType:                OAUTH
authEndpointName:        "bitbucket"
refreshTokenRouteName:   "bitbucket"   ← OAuth refresh routed via GK proxy
faIcon:                  ["fab", "bitbucket"]
roles:                   [HOSTING_SERVICE, login]   ← NOT an issue tracker
pullRequest.character:   "#"
requiresPATForUserPassAuth: true
PATsAreCalledAppPasswords:  true        ← UI label changes to "App Password"
supportsAssignees:       false
supportsLabels:          false
supportsTemplates:       false
supportsSSHModification: false
supportsUserRepos:       false
```

Bitbucket Cloud is **hosting-only**, never used as an issue tracker
in GK. Its PRs are slimmer (no assignees, no labels, no templates).

Default host: `bundle:201656`
`at.BITBUCKET_DEFAULT_BROWSER_HOST = "https://bitbucket.org"`.

### `bitbucketServer` (`bundle:166694`–`166751`)

```
hostname:                CUSTOM_HOSTNAME
hostnameLabel:           "Bitbucket Data Center"
label / verboseLabel:    "Bitbucket Data Center"
authType:                PAT
generateTokenPath:       "/account"
oldGenerateTokenPath:    "/plugins/servlet/access-tokens/add"
roles:                   [HOSTING_SERVICE]                ← hosting only, no issues, no login
requiresProToAuthenticate: true
requiresProjectToInitRepo: true
gkProjects.apiProvider:  "bitbucket_server"
```

The only entry with `requiresProjectToInitRepo: true` other than
Azure — Bitbucket Server's REST API requires a project key to
create a repo.

### `azureDevops` (`bundle:166752`–`166814`)

```
hostname:                CUSTOM_HOSTNAME
hostnameLabel:           "Azure DevOps"
label / verboseLabel:    "Azure DevOps"
authType:                PAT                           ← always PAT, even for cloud
authEndpointName:        "azure"                       ← refreshTokenRouteName: "azure"
generateTokenPath:       "/_usersSettings/tokens"
faIcon:                  ["fab", "windows"]
iconClassName:           "icon fa fa-windows"
iconId:                  hn.iconIds.azureDevopsIcon    ← uses GK icon, not pure FA
pullRequest.character:   "#"
pullRequest.supportsRequiredReviewers: true             ← only provider with this true
pullRequest.supportsSelfReview:        true
roles:                   [HOSTING_SERVICE, login]
alternateHostnamesForUrls: ["vs-ssh.visualstudio.com", "ssh.dev.azure.com", "dev.azure.com"]
issuesAreTiedToOneRepo:  false                          ← Azure issues are project-scoped
requiresProjectToInitRepo: true
```

Azure default browser host: `bundle:201654`
`at.AZURE_DEFAULT_BROWSER_HOST = "https://app.vssps.visualstudio.com/_apis"`.

`bundle:201653`:
`at.AZURE_DEVOPS_HOSTNAME = "dev.azure.com"`,
`at.VSTS_HOSTNAME = "visualstudio.com"`.

PAT submitted as Basic auth with empty username
(`bundle:52676`): `token: btoa(`:${at}`), isPAT: true`.

### `jiraCloud` (`bundle:166815`–`166850`)

```
hostname:                CUSTOM_HOSTNAME
verboseLabel:            "Jira Cloud"
label:                   "Jira"
authType:                OAUTH
authEndpointName:        "jira"
refreshTokenRouteName:   "jira"
roles:                   [issueTracker]                ← issue tracker only
issuesAreTiedToOneRepo:  false
allowEmptyIssueFilterText: false                        ← JQL queries must be non-empty
gkProjects.apiProvider:  "jira"
```

Jira Cloud is **issue-tracker only**, never a hosting service. The
Connect dialog has a unique extra step: after OAuth, GK fetches
"accessible resources" (Jira sites) via
`FETCH_JIRA_CLOUD_ACCESSIBLE_RESOURCES` IPC (`bundle:166983`).

### `jiraServer` (`bundle:166851`–`166885`)

```
hostname:                CUSTOM_HOSTNAME
verboseLabel:            "Jira Data Center"
label:                   "Jira"
authType:                USERNAME_AND_PASSWORD          ← only provider with this auth type
generateTokenPath:       "/secure/ViewProfile.jspa"
generateTokenParams:     "selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens"
minimumSupportedVersion: "8.4.0"
roles:                   [issueTracker]
allowEmptyIssueFilterText: false
gkProjects.apiProvider:  "jira_server"
```

Jira Server is the **only** entry with `authType: USERNAME_AND_PASSWORD`.
Despite that, the prefs dialog still encourages PAT via the
`generateTokenPath` link.

### `trello` (`bundle:166886`–`166919`)

```
hostname:                "trello.com"
hostnameLabel:           "Trello.com"
label / verboseLabel:    "Trello"
authType:                (none — custom flow)            ← no authType field set
roles:                   [issueTracker]
issuesAreTiedToOneRepo:  false
gkProjects.apiProvider:  "trello"
```

Special case in `buildAuthUrl` (`bundle:52635`):

```js
if (at === gn.issueTrackerTypes.TRELLO) return `${Ve}/trello-auth/authorize`;
```

Trello uses an **app-key + token** flow rather than OAuth2. Token
is added via `addTrelloAppKeyAndToken` (`bundle:146644`,
`bundle:259376`). The app key comes from `getTrelloAppKey`
(`bundle:203389`).

### `google` and `sso` (`bundle:166920`–`166939`)

```
roles: [gn]    ← login only
```

**Out of scope for chajá.** These represent the GK-account login
options shown on the Sign In screen, not per-provider integrations.

## Cross-provider feature matrix

Distilled from the `pullRequest` sub-objects:

| Provider | Drafts | Self-Review | Required reviewers | Multi-assignees | Templates |
|----------|--------|-------------|---------------------|------------------|-----------|
| github            | yes | no  | no  | yes | yes |
| githubEnterprise  | no  | no  | no  | yes | yes |
| gitlab            | no  | yes | no  | no  | yes |
| gitlabSelfHosted  | no  | yes | no  | no  | yes |
| bitbucket         | no  | no  | no  | n/a | no  |
| bitbucketServer   | no  | no  | no  | n/a | no  |
| azureDevops       | no  | yes | yes | n/a | yes |

Use this table when chajá's PR-create UI decides which form fields
to render. Don't toggle visibility based on `provider === "github"`
— read the field, mirror GK's data-driven approach.

## chajá deviation: drop GK-only fields

The following fields exist in GK's table but chajá MUST NOT mirror:

- `requiresProToAuthenticate`
- `enabledInGitKrakenEnterprise`
- `gkProjects.apiProvider` and `gkProjects.roles`
- `launchpadTabLabelTranslation`
- `refreshTokenRouteName` (only meaningful with the GK auth proxy)
- `authEndpointName` (only meaningful with the GK auth proxy —
  chajá's OAuth talks directly to provider endpoints)

Replace `authEndpointName` with `chajaOauthClientId` per provider
(chajá's own registered OAuth app per provider). See `03-oauth-flow.md`.

## chajá note: keep the table data-driven

The single biggest architectural win in GK's design is that
*everything downstream of Integrations is keyed by `integrationType`*
— the table at `bundle:166355` is consulted for icons, PR/MR
character glyphs, supported features, etc. Don't fork into per-provider
hardcoded UI components; build one rendering pass that reads the
table.

## Auth modes — provider reality vs GK enum vs chajá v1

GK collapses every auth combination into 3 enums (`bundle:201657`):

```js
at.authTypes = { OAUTH: "OAUTH", PAT: "PAT", USERNAME_AND_PASSWORD: "USERNAME_AND_PASSWORD" };
```

But the table below tracks what each provider's *actual REST/GraphQL
API* accepts (info from each provider's official docs, not the
bundle):

| Provider | OAuth | PAT / API token | user+pass | Notes |
|----------|-------|-----------------|-----------|-------|
| GitHub.com | ✅ | ✅ | ❌ | user+pass deprecated for API in 2020 |
| GitHub Enterprise | ✅ | ✅ | ❌ | self-hosted ≥ 2.20 |
| GitLab.com | ✅ | ✅ | ❌ | |
| GitLab self-hosted | ✅ | ✅ | ❌ | |
| Bitbucket Cloud | ✅ | ✅ App Password | ❌ | basic auth deprecated 2018 |
| Bitbucket Data Center | ✅ | ✅ | ⚠️ legacy | self-hosted only, on-prem |
| Azure DevOps | ✅ Entra ID | ✅ | ❌ | |
| Jira Cloud | ✅ | ✅ API Token | ❌ | |
| Jira Server / Data Center | ❌ | ✅ | ⚠️ legacy | self-hosted only |
| Trello | ❌ | custom app-key+token | ❌ | not OAuth2 — chajá skips v1 |

**SSH is not in this table** — SSH is a git transport for push/fetch,
not an API auth mode. chajá already handles SSH via
`build_credentials_callbacks` (SSH agent → credential helper →
default) for git ops. Provider integrations live entirely on top of
HTTPS APIs; the SSH layer is orthogonal.

### chajá v1 decision: OAuth primary + PAT fallback. Skip user+pass.

- **Primary path**: OAuth (PKCE direct to provider, no GK auth proxy).
- **Fallback path**: PAT — universal, every provider that matters
  supports it.
- **Drop entirely**: `USERNAME_AND_PASSWORD` mode. Only Jira Server /
  Data Center on-prem still accepts it, and even there PAT is the
  recommended replacement. The two `⚠️ legacy` entries above are
  niche enough that chajá v1 punts; reintroduce only if a real user
  asks.

Effect on the data-driven rendering: chajá's local copy of the
provider table replaces GK's `authType: "USERNAME_AND_PASSWORD"`
entries with `authType: "PAT"`. The `04-pat-fallback.md` PAT-entry
flow then covers them transparently.
