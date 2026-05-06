# 11 — GK-only / out-of-scope behaviour

Behaviours intentionally NOT mirrored in chajá #100.

## SaaS-tied features

| Feature | Bundle reference | Why skip |
|---|---|---|
| GK Workspaces (multi-repo bundles) | `bundle:168120` `ONBOARDING_GO_TO_CREATE_WORKSPACE` | Closed-source GK SaaS; no chajá analogue |
| GitKraken Tutorial overlay | `bundle:5623`, `bundle:5647` `OnboardingTutorialOverlay` | GK-proprietary onboarding UX; chajá ships docs separately |
| `GITKRAKEN_INTRO_VIDEO_URL` button | `bundle:294787` "watch video" | Promotes GK SaaS; chajá unbranded |
| `GITKRAKEN_HELP_HOME_URL` button | `bundle:294791` "view docs" | Same; chajá's docs are at the chajá repo / in-app help |
| AI commit summary onboarding | `bundle:168110`, `bundle:238173` | GK AI Assist proprietary |
| Suggested-orgs flow | `bundle:168114-168118` | GK SaaS (org auto-discovery) |
| Cloud Patches (GK SaaS feature) | bundle paths involving `cloudPatch*` | Closed-source SaaS |
| GitKraken Dot Dev integrations | `bundle:168121+` | Web-app companion |

## Init-on-hosting-service flow

`bundle:43892-43895` — when GK creates a repo on GitHub/GitLab/etc.
**SKIP entirely**. Steps GK does that chajá v1 doesn't:

1. POST `/repos` to the hosting service API (org-aware) using the
   user's stored OAuth token.
2. Wait for hosting service to provision the repo + return the clone
   URL.
3. Run normal clone flow against the new repo.
4. (Optional) Push initial commit if `cloneAfterInit && initialCommit`.

This requires per-provider API surfaces (`createRepoForUser`,
`createRepoForOrg`) at `bundle:15830-15866`. **Out of scope for #100.**
File a follow-up issue once the per-provider clients (D3+) land:

> **feat(integrations): create repository on hosting service from Init
> dialog.** Add a "Create on" picker to the Init form that lists
> connected providers; after local init, POST to the provider's
> `/repos` endpoint using the stored OAuth token, then `git remote add`
> + push.

## SSH-key-by-integration UX

`bundle:209707` `CloneSshSettings` — collapsible inside the Clone form
that lets the user pick which integration's SSH key to use. Depends on
GK's per-integration SSH-key store. chajá: defer; rely on global ssh-
agent for v1 (see doc 05).

## Default-branch sourcing from profile

`bundle:131706` `recurseSubmodules: yield select(getAutoUpdateSubmodules)`
and other GK profile settings (`repoInit.lastRepoInitPath`,
`repoInit.defaultBranchName`). chajá v1: read defaults from
`gix::config` (the user's `~/.gitconfig`) — `init.defaultBranch` for
branch name, etc. Fall back to `"main"`. **No chajá-specific profile
settings for onboarding in v1.**

## Sparse checkout

`bundle:208947` `CloneRepo-SparseCheckoutToggle`. GK has a full sparse-
checkout subform with patterns. chajá: gix sparse checkout is
incomplete. Defer.

## LFS init

`bundle:286105` `Lfs-InitializeWithLfs`. chajá has no LFS. Defer.

## Telemetry

GK emits `INIT_REPO` and `CLONE_REPO_STARTED` telemetry events.
chajá: no telemetry. Skip entirely.

## Tab-bound init view

GK lets the user launch Init/Clone forms from a "+ new tab" tab strip
(via the cluster Tabs feature). chajá's tabs cluster #135 is parked.
v1: launch onboarding dialogs from `ColdStart` and `RepoManagement`
buttons only (the two surfaces that already exist).
