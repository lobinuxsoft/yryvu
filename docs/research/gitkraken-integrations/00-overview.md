# Integrations — top-level architecture

GitKraken's "Integrations" surface is the user's connection to
provider APIs (GitHub, GitLab, Bitbucket, Azure DevOps, Jira,
Trello). It's an **in-app Preferences tab** plus a small constellation
of inline CTAs that deep-link into that tab when a feature needs
credentials.

This audit covers everything chajá needs to clone the surface 1:1
end-to-end: the table of providers, the OAuth + PAT flows, the
storage backend, the connection-management UI, the inline CTAs,
the error states.

## Reading order

| # | File | Topic |
|---|------|-------|
| 00 | `00-overview.md` | this file |
| 01 | `01-entry-points.md` | every dispatch site that opens Integrations |
| 02 | `02-providers-table.md` | per-provider reference (the canonical table) |
| 03 | `03-oauth-flow.md` | OAuth via the GK auth proxy (`buildAuthUrl`) |
| 04 | `04-pat-fallback.md` | manual PAT entry path |
| 05 | `05-connection-management.md` | the Preferences > Integrations UI |
| 06 | `06-token-storage.md` | how tokens are persisted on disk |
| 07 | `07-connection-required-prompts.md` | inline CTAs ("Connect to view PRs") |
| 08 | `08-error-states.md` | auth-failed / expired / scope errors |
| 09 | `09-out-of-scope-proprietary.md` | what chajá MUST skip |
| 10 | `10-chaja-implementation-hints.md` | translating to Tauri+SolidJS |

## Providers GK 12.0.1 supports

The master table (`bundle:166355`–`166940`, exported as
`integrationInfo`) defines exactly **12 entries**, but only **10
are user-facing integrations** — `google` and `sso` exist for
GK-account login only and are out of scope here.

| `type` | `label` | Role(s) | Auth |
|--------|---------|---------|------|
| `github` | GitHub | hosting + issue tracker + login | OAUTH |
| `githubEnterprise` | GitHub Enterprise Server | hosting + issue tracker | PAT |
| `gitlab` | GitLab | hosting + issue tracker + login | OAUTH |
| `gitlabSelfHosted` | GitLab (Self-Managed) | hosting + issue tracker | PAT |
| `bitbucket` | Bitbucket | hosting + login | OAUTH |
| `bitbucketServer` | Bitbucket Data Center | hosting | PAT |
| `azureDevops` | Azure DevOps | hosting + login | PAT |
| `jiraCloud` | Jira | issue tracker | OAUTH |
| `jiraServer` | Jira Data Center | issue tracker | USERNAME_AND_PASSWORD |
| `trello` | Trello | issue tracker | (custom app-key flow) |

Roles come from `bundle:166380`+ `roles: [dn.HOSTING_SERVICE, mn, gn]`
where `mn` = issue-tracker role, `gn` = login role. The reduce at
`bundle:166947`–`166950` filters the full table into per-role
sub-maps:

- `hostingServiceInfo` (role `HOSTING_SERVICE`)
- `issueTrackerInfo` (role `mn`)
- `loginInfo` (role `gn`) — GK account login, **out of scope**

`integrationTypes` / `hostingServiceTypes` / `issueTrackerTypes` are
auto-generated `UPPER_SNAKE_CASE` keys via `getUpperSnakeCaseKeysToKey`
(`bundle:166941`).

## Auth modes (the only three)

`bundle:201657`:

```js
at.authTypes = { OAUTH: "OAUTH", PAT: "PAT", USERNAME_AND_PASSWORD: "USERNAME_AND_PASSWORD" };
```

Every provider declares exactly one as its primary `authType`. PAT
is also the universal fallback (see `04-pat-fallback.md`):
`handleManualIntegrationTokenInput` (`bundle:146636`) accepts manual
token entry for GitHub / GitLab / Bitbucket / Azure / Jira Cloud /
Trello regardless of primary mode.

## Tab order in the Preferences sidebar

`bundle:119112`:

```js
at.orderedIntegrationSubTabTypes = [
  Rn.GITHUB, Rn.GITHUB_ENTERPRISE, Rn.GITLAB, Rn.GITLAB_SELF_HOSTED,
  Rn.BITBUCKET, Rn.BITBUCKET_SERVER, Rn.AZURE_DEVOPS,
  Rn.JIRA_CLOUD, Rn.JIRA_SERVER, Rn.TRELLO
];
```

Match this verbatim. Don't alphabetise. Don't promote the
"connected" ones to the top.

## What chajá clones vs skips

**Clone (v1):** GitHub, GitLab, Bitbucket Cloud, Azure DevOps as
hosting services. GitHub Issues + Jira Cloud as issue trackers.

**Clone (v2):** GitHub Enterprise, GitLab self-hosted, Bitbucket
Data Center (the on-prem variants). Adds custom-hostname plumbing.
PAT-only auth — simpler than v1's OAuth.

### Auth modes — chajá v1 decision

GK supports 3 enums (`OAUTH` / `PAT` / `USERNAME_AND_PASSWORD`).
chajá ships **2**:

- **Primary**: OAuth via PKCE, direct to each provider (chajá registers
  its own OAuth apps; no GK auth proxy — see `03-oauth-flow.md`).
- **Fallback**: PAT — universal across every provider chajá supports.
- **Dropped**: `USERNAME_AND_PASSWORD`. Only Jira Server / Data Center
  on-prem still accepts it, and PAT is the upstream-recommended
  replacement. SSH is not an API auth mode (transport-only) and stays
  on the existing `build_credentials_callbacks` path for git ops.

See `02-providers-table.md` "Auth modes — provider reality vs GK enum
vs chajá v1" for the full per-provider matrix.

**Skip outright (proprietary, see `09-out-of-scope-proprietary.md`):**

- `google` and `sso` integration entries (GK account login, not
  per-provider tokens).
- The **GK auth proxy** (`buildAuthUrl` at `bundle:52634` routes
  OAuth through `${apiUrl}/oauth/${authEndpointName}/login`). chajá
  must implement direct OAuth against each provider, not via a GK
  intermediary.
- `gkProjects.apiProvider` field — used by GK Workspaces /
  Launchpad cross-repo aggregation. Not relevant per-repo.
- `requiresProToAuthenticate: true` (`bundle:166447`,
  `166576`, `166702`) — paywall on self-hosted variants. chajá has
  no Pro tier; gate-removed.
- `enabledInGitKrakenEnterprise: true` — GK on-prem distribution
  flag, irrelevant.
- `launchpadTabLabelTranslation` — for GK Launchpad, skip.

## chajá deviation: no GK auth proxy

GK funnels OAuth through `${getApiUrl}/oauth/<provider>/login` — a
service it controls. chajá must talk OAuth directly to each provider's
own authorize endpoint and register its **own** OAuth app per
provider. See `03-oauth-flow.md` for what the GK proxy abstracts and
what chajá has to reimplement raw.
