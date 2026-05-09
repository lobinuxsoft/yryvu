# 00 — Onboarding overview

Audit of GitKraken's onboarding flow covering the three entry actions:
**Open** (existing local repo), **Clone** (remote URL or hosting-service
discovery), **Init** (create a new local repo, optionally with template
files). Targets yryvu issue #100 (`feat(onboarding): open / clone / init
repo dialogs`).

Bundle: `app/src/render/static/entryPoints/main/render.bundle.js`,
prettified to `/tmp/gk-bundle-pretty.js` (414128 lines). Citations use
`bundle:LINE` against the prettified file.

## Top-level finding (correction vs. issue body assumption)

The original prompt assumed `OnboardingChooseRepoForm` was the 3-way
picker (Open/Clone/Init). It is **not**. `OnboardingChooseRepoForm`
(`bundle:294760`) is a **folder scanner** that searches a chosen parent
directory for existing git repos and lets the user pick one. It is the
"batch open" surface used during the GK first-run experience.

The actual 3-way "what do you want to do" branching point is implemented
as discrete buttons on the GK welcome screen and on the GK Repo
Management view, each opening a dedicated form (Open / Clone / Init).
yryvu already mirrors that shape: `ColdStart/index.tsx:33-37` and
`RepoManagement/index.tsx:122-147` render three buttons today, with
Clone/Init disabled. Wiring those two disabled buttons to dedicated
forms is the actual #100 surface.

## Form symbols (minified -> human-readable)

| Symbol | Bundle line | Role |
|---|---|---|
| `OnboardingOpenRepoForm` | `bundle:96623` | Pick an existing local folder + enter |
| `OnboardingCloneRepoForm` | `bundle:209655` | Multi-tab clone form (URL / per-hosting) |
| `OnboardingChooseRepoForm` | `bundle:294760` | Folder scanner for batch-open (NOT picker) |
| `InitRepoForm` (no `Onboarding` prefix) | `bundle:286032` | Multi-tab init form (Local / per-hosting) |

The Init form uses i18n key prefix `InitRepo-` (no `Onboarding-`). Its
"Local" subview is keyed by `InitRepo-InitLocally` (`bundle:92345`). The
Clone form's URL-mode subview is keyed by `CloneRepo-CloneViaUrl`
(`bundle:92333`). Both share the same tab-rendering helpers in module
22255 (`bundle:92291` `getByURLTab` / `getLocalInitTab` /
`getHostingServiceTabs`).

## Onboarding nav events

Three discrete `ONBOARDING_GO_TO_*` event types are dispatched from the
welcome screen action buttons (`bundle:168118-168121`):

```
ONBOARDING_GO_TO_OPEN_REPO   -> opens OpenRepoForm
ONBOARDING_GO_TO_CLONE_REPO  -> opens CloneRepoForm
ONBOARDING_GO_TO_CREATE_REPO -> opens InitRepoForm (note "Create" label)
```

Plus `ONBOARDING_GO_TO_CREATE_WORKSPACE` (`bundle:168120`) which is GK
proprietary (Workspaces) and out of scope.

## Surface taxonomy

GK exposes the three forms in two places:

1. **First-run welcome screen / FTUX** (post-login). Big buttons, big
   imagery (`OnboardingImgRelativePaths.openRepoKeif` at `bundle:96644`).
   Equivalent in yryvu: `ColdStart/index.tsx`.
2. **Repo Management permanent tab**. Top-of-list action row:
   Open / Clone / Init. Equivalent in yryvu:
   `RepoManagement/index.tsx:122-147`.

Both surfaces use the **same modal forms**. The forms self-detect the
context via Redux state (`isLoggedIn`, `serviceIsConnected`, etc.) and
render different tabs accordingly — see `01-choose-form.md` for what
yryvu needs to skip and `03-clone-form.md` / `06-init-form.md` for the
tab structures.

## Document tree

| Doc | Topic |
|---|---|
| 00-overview.md | This file |
| 01-choose-form.md | OnboardingChooseRepoForm (folder scanner — yryvu: defer) |
| 02-open-form.md | OnboardingOpenRepoForm (yryvu has it, gap analysis) |
| 03-clone-form.md | OnboardingCloneRepoForm fields + URL-tab structure |
| 04-clone-progress.md | Clone progress reporting + cancel UX |
| 05-clone-auth.md | HTTPS/SSH detection + credential helper integration |
| 06-init-form.md | InitRepoForm Local-tab fields + bootstrap saga |
| 07-gitignore-templates.md | Where the gitignore picker pulls templates from |
| 08-license-templates.md | Where the license picker pulls templates from |
| 09-errors.md | Error classes + UI presentation |
| 10-recents-integration.md | post-clone / post-init wire to recents cache |
| 11-proprietary-skips.md | GK-only behaviours to skip |
| 12-yryvu-implementation-hints.md | Wiring recipes for #100 |
| strings.md | All onboarding-touched i18n strings, verbatim |

## Triage summary

| Behaviour | Triage | Why |
|---|---|---|
| Open existing local repo | **DONE** | yryvu `ColdStart` + `RepoManagement` already wire this via `@tauri-apps/plugin-dialog`. No changes needed for #100 unless we want gap-fix items from doc 02. |
| Clone via URL (HTTPS / git@ / file://) | **KEEP** | Core scope of #100. Doc 03 + 04 + 05. |
| Clone via hosting-service repo picker | **SKIP v1** | Depends on cluster Integrations OAuth (D2/#278 done) + per-provider repo-list APIs (D3+ pending). Filed: defer to follow-up issue once D3 lands. |
| Init local repo (path + branch + gitignore + license + first commit) | **KEEP** | Core scope of #100. Doc 06 + 07 + 08. |
| Init repo on hosting service | **SKIP** | GK proprietary integration (`createRepo` saga at `bundle:43892` issues `POST /repos` to GitHub/GitLab API). Out of scope. |
| `OnboardingChooseRepoForm` folder-scanner | **FLAG / defer** | Useful UX (scan a folder, batch-pick repos) but RepoManagement covers the equivalent need post-Open. Defer to follow-up. |
| LFS init toggle | **FLAG / defer** | GK shows a checkbox if `isLfsInstalled` (`bundle:286105`). yryvu has no LFS yet. Defer. |
| GPG signing of initial commit | **FLAG / defer** | GK shows a passphrase row if `signByDefault && !cachedGpgPassphrase` (`bundle:286114`). Out of #100 scope; defer to GPG cluster. |
| Shallow clone | **FLAG / partial** | GK has a collapsible "Shallow clone" panel (`bundle:209703`). gix's `prepare_clone` supports `with_shallow`. Worth including a single-row "Clone depth" input as a v1 win. |
| Sparse checkout | **SKIP v1** | gix sparse checkout support is incomplete. Defer. |
| Recurse-submodules toggle | **FLAG / off-by-default** | GK reads from `getAutoUpdateSubmodules` profile setting (`bundle:131706`). yryvu: a single checkbox in Clone form, default ON, mirroring GK's default at `bundle:188608` (`recurseSubmodules: ua.recurseSubmodules ?? !0`). |
| "Open in new tab" after clone/init | **KEEP** | GK default is `OPEN_IN_NEW_TAB` (`bundle:188504`). yryvu: call `openRepoInAnotherTab` from `tabs/ops.ts` post-success — same path `ColdStart` uses today. |

## Cross-validation note

I re-grepped 4 of the citations in this doc to confirm they line up:

- `OnboardingOpenRepoForm-title` exists at `bundle:96623`: confirmed.
- `OnboardingChooseRepoForm-title` exists at `bundle:294760`: confirmed.
- `OnboardingCloneRepoForm-title` exists at `bundle:209655`: confirmed.
- `InitRepo-InitARepo` rendered at `bundle:82647`: confirmed.

No inversions vs. the prompt's primary claims. The only correction is
the role of `OnboardingChooseRepoForm` (folder scanner, not 3-way
picker) — call this **Inversion #1** for the report-back summary.

## yryvu-deviation FLAGs surfaced in this overview

1. **Hosting-service tabs are SKIP v1.** GK's URL-tab is part of a tab
   container; yryvu's clone form should render only the URL pane until
   D3+ provider clients land.
2. **`OnboardingChooseRepoForm` folder-scanner has no yryvu analogue.**
   Defer; not in #100 scope. RepoManagement handles batch-open via
   recents.
3. **Init form is shaped around hosting-service create-and-push.** The
   Local tab is only one of N. yryvu renders only Local, no tab chrome
   needed in v1.
