# Out-of-scope: GitKraken-proprietary surfaces inside Integrations

This doc enumerates every Integrations-adjacent surface that
requires the GitKraken backend service / hosted infrastructure to
function. chajá explicitly does **not** implement these — but
contributors should understand *why* each one is skipped, not just
that it is.

Cross-reference with `gitkraken-left-panel/11-out-of-scope-proprietary.md`
for LeftPanel-side equivalents.

## The GK auth proxy itself

**What it is:** every OAuth flow in GK routes through an auth
proxy at `${getApiUrl}/oauth/${authEndpointName}/login`
(`bundle:52638`). GK holds the OAuth client_secret server-side so
the desktop app never ships it.

**Why it requires the GK service:** the proxy IS the service.
Without it, the OAuth flow can't complete because GK's published
OAuth apps are registered with the proxy's redirect URLs, not
local ones.

**chajá equivalent:** chajá registers its **own** OAuth apps per
provider (`chaja` on GitHub, `chaja-app` on GitLab, etc.) and
runs raw OAuth + PKCE against each provider directly. See
`03-oauth-flow.md`. Replace `authEndpointName` with chajá-side
client_id mappings.

## `gkProjects.apiProvider` / GK Workspaces / Launchpad

**What it is:** every entry in the integrations table has a
`gkProjects: { roles: […], apiProvider: "github" }` sub-object
(`bundle:166434`+). This drives GK's cross-repo aggregation
features (Workspaces, Launchpad, FocusView).

**Why it requires the GK service:** Workspaces are saved on GK's
backend; Launchpad is a GK-hosted aggregator that syncs PR/issue
state across all the user's connected providers.

**Bundle evidence:**

```js
gkProjects: { roles: [HOSTING_SERVICE, mn], apiProvider: "github" }
```

The `apiProvider` strings (`"github"`, `"github_enterprise"`,
`"gitlab"`, `"gitlab_self_hosted"`, `"bitbucket"`,
`"bitbucket_server"`, `"azure"`, `"jira"`, `"jira_server"`,
`"trello"`) are the GK-side provider identifiers GK Cloud uses to
correlate desktop-stored credentials with hosted-aggregator
records.

**chajá equivalent:** none. chajá is single-repo. Drop `gkProjects`
from chajá's mirror of the table.

## `requiresProToAuthenticate`

**What it is:** five entries in the table set this true
(`bundle:166447`, `166576`, `166702`, `166760`, `166447`):

- `githubEnterprise`
- `gitlabSelfHosted`
- `bitbucketServer`
- `azureDevops`

**Why it requires the GK service:** GK Pro is a paid tier of GK's
license server. Enterprise/self-hosted integrations are gated
behind the paywall.

**chajá equivalent:** **none.** chajá has no Pro tier — every
provider is available to every user. Drop this field.

## `enabledInGitKrakenEnterprise`

**What it is:** flag for whether the integration is enabled in
GK's enterprise on-prem distribution. True for enterprise/self-hosted
variants, false for cloud variants.

**Why it requires the GK service:** GK Enterprise is a separately
distributed/licensed binary. The flag is meaningless outside
GK's licensing infrastructure.

**chajá equivalent:** **none.** Drop the field.

## `launchpadTabLabelTranslation`

**What it is:** every provider entry has a sub-object with i18n
keys for FocusView/Launchpad tab labels (`bundle:166393`+):

```js
launchpadTabLabelTranslation: {
  PERSONAL: { PULL_REQUEST: "FocusView-MyPullRequests",
              ISSUE:        "FocusView-MyIssues" },
  TEAM:     { PULL_REQUEST: "FocusView-PullRequests",
              ISSUE:        "FocusView-Issues" }
}
```

**Why it requires the GK service:** Launchpad / FocusView is the
cross-repo aggregator UI, hosted by GK.

**chajá equivalent:** **none.** Drop the field.

## `refreshTokenRouteName`

**What it is:** for OAuth providers with refresh tokens
(`bitbucket` → `"bitbucket"` at `bundle:166679`, `azureDevops` →
`"azure"` at `bundle:166768`, `jiraCloud` → `"jira"` at
`bundle:166840`), this is the path slug for the GK proxy's refresh
route: `${getApiUrl}/oauth/${refreshTokenRouteName}/refresh`.

**Why it requires the GK service:** same as `authEndpointName` —
the proxy holds the client_secret needed for refresh.

**chajá equivalent:** chajá hits providers' refresh endpoints
directly with PKCE-issued refresh tokens. Drop the field; replace
with chajá-side refresh URL mapping in code.

## `google` and `sso` integration entries

`bundle:166920`–`166939`:

```js
google: {
  type: "google", label: "Google",
  roles: [gn], integrationConnectionTypes: [],
  iconClassName: "icon fa fa-google"
},
sso: {
  type: "sso", label: "SSO",
  roles: [gn], integrationConnectionTypes: [],
  iconClassName: "icon fa fa-key"
}
```

**What they are:** GK-account login providers. Used in the
top-bar "Sign in to GitKraken" menu, not as per-provider
integrations.

**Why they require the GK service:** they ARE login *to* GK. There
is no GK account in chajá to sign into.

**chajá equivalent:** **none.** Drop both entries.

## SSO login deep-link (`bundle:138712`)

```js
yield call(openExternal,
  `${apiUrl}/oauth/sso/login?action=login&in_app=true&sso_connection_id=${Ve.id}`)
```

GK's enterprise SSO flow — opens browser to the GK auth proxy
which then federates to the user's company IDP.

**chajá equivalent:** **none.** chajá has no GK account; SSO into
provider tokens (e.g. GitHub Enterprise behind Okta) is just
GitHub Enterprise's own SSO flow which the user does in-browser
when authorising chajá's OAuth app. No special handling needed in
chajá's code.

## GitKraken AI assist for integrations

**What it is:** features like "AI explain pull request",
"AI summarize PR diff", "AI suggest reviewers". They appear in
the PR review surface, not in Integrations preferences directly,
but they consume integration tokens to fetch the context.

**Why they require the GK service:** GK's AI inference proxy
holds the model API keys; even BYO-key flows route through GK
code paths.

**chajá equivalent:** **none in v1.** Per chajá's MVP scope (and
matching the LeftPanel audit's same call): no AI features.

## `gkapi.gitkraken.com` / `gitkraken.dev` URLs

Search the bundle for any URL ending in `gitkraken.com` or
`gitkraken.dev` (`bundle:22220`, `39476`, `41324`, `50084`,
`84877`, `228535` — all opens via `openExternal`). These are
either:

1. Help / documentation URLs (fine to mirror with chajá's docs
   site if it exists)
2. GK service URLs (Cloud Patches, Workspaces, GitKraken account)
   — never mirror

When in doubt, **don't link to a GK URL from chajá**. The chajá
team can replace help links with chajá's own docs (or upstream
provider docs).

## What chajá's mirror of the integrations table SHOULD look like

After dropping all the proprietary fields, the chajá table is
~half the size:

```rust
struct IntegrationProvider {
    type_id:            IntegrationType,    // enum
    label:              &'static str,
    verbose_label:      &'static str,
    hostname_label:     &'static str,
    hostname:           Hostname,            // Specific(&str) | Custom
    is_self_hosted:     bool,
    minimum_supported_version: Option<&'static str>,
    icon:               IconRef,
    pull_request:       Option<PullRequestSupport>,
    auth_type:          AuthType,            // OAUTH | PAT | USER_PASS
    chaja_oauth:        Option<OAuthConfig>, // chajá's per-provider OAuth client config
    generate_token_path:    Option<&'static str>,
    old_generate_token_path: Option<&'static str>,
    generate_token_params:   Option<&'static str>,
    requires_pat_for_user_pass: bool,
    pats_are_called_app_passwords: bool,
    requires_project_to_init_repo: bool,
    issues_are_tied_to_one_repo: bool,
    allow_empty_issue_filter_text: bool,
    alternate_hostnames_for_urls: &'static [&'static str],
    pull_request_view_supported: bool,
    supports_ssh_modification: bool,
    supports_user_repos: bool,
    supports_getting_parent_repo: bool,
    has_efficient_fork_refetch_implementation: bool,
}
```

## Why we documented them anyway

A maintainer reading the bundle will encounter these fields and
strings in every per-provider record. Without this audit they
might mistakenly mirror them, then waste days wiring up a
"workspaces" surface or a "Pro tier paywall" that has no business
existing in chajá.

The chajá team should:

1. **Recognise** these field names on sight when reading GK's code.
2. **Have a one-line answer** for "why doesn't chajá have
   Workspaces / Cloud Patches / Launchpad?": those are GK-hosted
   aggregators that require GK's backend; chajá is single-repo,
   client-only.
3. **Ship without them.** Don't be tempted by the `gkProjects`
   field or the launchpad i18n keys — they're dead code in chajá's
   universe.

If chajá ever wants cross-repo PR triage, design it from scratch
as a local-only feature (e.g. "open these N repos as tabs, query
each one's PRs in parallel, render a flat list in a new tab").
Don't try to be a GK Workspaces clone; that needs infrastructure
chajá doesn't have.
