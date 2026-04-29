# Out-of-scope: GitKraken-proprietary surfaces inside the LeftPanel

This doc enumerates every LeftPanel surface that requires the
GitKraken backend service / hosted infrastructure to function.
chajá explicitly does **not** implement these — but contributors
should understand *why* each one is skipped, not just that it is.

## CLOUD_PATCHES — proprietary patch sharing service

**What it is**: a section that lists "shared drafts" (working-tree
patches uploaded to GK's `gkapi.gitkraken.com` patch service so
they can be shared with teammates). Sub-grouped into "Created by
me", "Shared with me", "Recently opened".

**Why it requires the GK service**: the patches are *hosted on GK
infrastructure*. There's no peer-to-peer exchange; the upload
target is a GK API endpoint, the download is from the same
endpoint, and access control is via the user's GK account
membership in an organization.

**Bundle evidence** (file `/93813`):

```js
getShowCloudPatchesSection = createSelector(
  getIsDraftsEnabled,                  // ← GK feature flag, defaults false on free tier
  Boolean);

makeCloudPatchesSection = createSelector(
  getShowCloudPatchesSection,
  getCloudPatchRows,
  …,
  (show, rows, …) => show
    ? getLeftPanelSection(CloudPatchesHeader, HEADER_HEIGHT, …, CLOUD_PATCHES, count)
    : null);

mapCloudPatchToMaybeLeftPanelRow(Ve, alias, disabled) {
  const { id, changesets, deepLink, title } = Ve;
  return { /* deepLink: "https://gitkraken.dev/drafts/<id>" */ };
}
```

The `deepLink` field on every patch row points at
`gitkraken.dev/drafts/<id>` — that's the GK web frontend for the
service.

**chajá equivalent**: **none in v1**. A future "share patch" feature
in chajá would more naturally be implemented as a `git format-patch`
+ "Save to file" / "Send via system share sheet" flow, with no
hosted backend. Don't try to recreate the cloud-hosted variant.

## TEAM_VISIBILITY — GK organization-hosted feature

**What it is**: a section that shows a list of *team members* (from
your GK organization) and which repos each one has worked on
recently. Used to coordinate "who is touching what".

**Why it requires the GK service**: team membership comes from GK's
organization service. The activity stream ("who pushed what
recently") is fed by a hosted aggregator that watches push events
across the org's repos. None of this is derivable from the local
git repo or a single provider API.

**Bundle evidence** (file `/91841`):

```js
mapTeamMemberToLeftPanelRow = (…, teamMember, …) => ({
  contentComponent: TeamVisibilityRow,
  type: TEAM_VISIBILITY_MEMBER,
  /* teamMember object comes from GK's team service */
});

getTeamVisibilityRows = createSelector(
  getSortedFilteredTeamMembers,                     // from team service
  …,
  getMergedTeamInfos,                               // from team service
  getShouldShowActivityStatus,                      // GK service feature flag
  …,
  /* the "TEAM-MESSAGE-UPGRADE" override row appears for free-tier users */
);
```

The free-tier upgrade nag (`TEAM_MESSAGE_UPGRADE_HEIGHT = 210`) and
the "no teams" message (`TEAM_MESSAGE_NO_TEAMS_HEIGHT = 100`) are
explicit GK-paywall affordances. chajá has no paywall and no
hosted team service.

**chajá equivalent**: **none.** A future "show recent commits by
each contributor" feature could be implemented from `git shortlog`
+ provider API contributors data, but it would be a different
feature with different semantics — not a clone of TEAM_VISIBILITY.

## Focus View / Launchpad — out of LeftPanel, but related

**What it is**: not a LeftPanel section per se, but worth noting
because the chajá team will encounter it in screenshots. It's a
top-level *view* (like a tab) that aggregates PRs and issues *across
all the user's repos* from connected providers, sorted by GK's
"focus algorithm" (assigned to me, mentioned, requested review,
recent activity).

**Why it requires the GK service**: cross-repo aggregation
requires GK to maintain a synchronised view of every connected
provider on the user's behalf. It's not strictly impossible
without a service — chajá could in theory query each provider for
each repo on every refresh — but the result would be slow and
rate-limit-heavy. GK does it server-side and pushes deltas.

**chajá equivalent**: **none.** chajá is a single-repo client by
design. If cross-repo PR triage is needed, it lives in the
provider's own UI (github.com, gitlab.com) or in a dedicated tool.

## Workspaces — out of LeftPanel, but related

**What it is**: GK's notion of a "workspace" is a saved set of repos
that you can open all at once, with associated metadata (cloud
patches, team membership, notifications). Workspaces show up as
tabs in the top-level UI, not as a LeftPanel section.

**Why it requires the GK service**: workspace definitions live in
GK's account database, not in any local config. The "shared
workspace" feature lets your teammate's tab list mirror yours.

**chajá equivalent**: **none in v1.** chajá's tab system is
local-only. A future "save my open repos as a session" feature
could ship without any service — but that's its own design, not
a clone of Workspaces.

## GitKraken Insights / activity stream

**What it is**: a panel (not in the LeftPanel) showing telemetry-fed
metrics like "commits per day", "lines added by X this week", etc.
Sometimes surfaces in the LeftPanel via the team visibility
"recent activity" decorations.

**Why it requires the GK service**: the metrics are aggregated on
GK's backend from telemetry, push events, and provider activity
feeds. The dashboard is rendered from GK's own analytics service.

**chajá equivalent**: **none.** Local `git log --pretty` plus a
chart library could produce per-developer metrics for the open
repo, but cross-repo and team metrics require infrastructure
chajá doesn't have.

## GitKraken Account / GitKloud sync / login flows

**What it is**: the OAuth / SSO / email-password login flows that
unlock all of the above features. Surfaces in the top-bar avatar
menu, not in the LeftPanel directly — but the LeftPanel checks
several `isLoggedIn` / `getIsAboveFreeTier` selectors to decide
whether to render upgrade nags.

**Why it requires the GK service**: login flows are *with* GK as
the identity provider. The session token is verified against GK's
auth service. Even SSO with the user's company IDP routes through
GK.

**chajá equivalent**: **none.** chajá uses provider-native OAuth
(GitHub PAT or OAuth, GitLab PAT, etc.) directly, never a GK
intermediary. There is no chajá account; the only credentials
stored are per-provider tokens.

## AI features (commit explain, branch explain, generate commit message)

**What it is**: GK 12 ships AI features powered by GK's own
inference proxy (which fans out to OpenAI / Anthropic / Azure
OpenAI / others). They appear as menu entries
(`ContextMenu-ExplainBranchChangesPreview`,
`ContextMenu-GenerateCommit*`) and as right-panel views
(`EXPLAIN_COMMITS`, `EXPLAIN_WIP`, `EXPLAIN_BRANCH`).

**Why it requires the GK service**: GK's inference proxy is what
holds the API keys; users can opt to BYO key but the routing logic
still goes through GK code paths.

**chajá equivalent**: **none in v1.** AI features are explicitly
out of scope for the chajá MVP per the project's own README. If
they ever land, they'd be BYO-key only with no GK proxy.

## Why we documented them anyway

Reading the bundle, you encounter every one of these surfaces
mixed into the same selectors and components as the pure-git
ones. A maintainer who didn't know "Cloud Patches" was
proprietary might mistakenly try to implement it from the
selector chain alone (which *looks* implementable — it's just
data flowing through createSelector chains like everything else).

The chajá team should:

1. Know the names of these surfaces so they can recognise them on
   sight when reading GK's code or screenshots.
2. Have a one-line answer when contributors ask "why doesn't
   chajá have a Cloud Patches section?"
3. Be ready to explain to users that "no, you can't share a
   working-tree patch via chajá the way you can via GK" — and
   point them at `git format-patch` as the open alternative.

If the chajá maintainers ever want to add equivalents, design
them from scratch as **local-only, file-based features** that
don't pretend to be a clone of the GK service version. The
mental model is incompatible: GK's features are "share with my
team via GK's hosted infrastructure"; chajá's features are
"manipulate my local repo and the providers I connect to
directly".
