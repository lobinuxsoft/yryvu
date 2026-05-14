# 03 — OnboardingCloneRepoForm (URL-tab fields)

The Clone form is **multi-tab**. The tabs are:

1. **URL** — universal, always present (`getByURLTab` at
   `bundle:92335-92347`). i18n key `CloneRepo-CloneViaUrl`.
2. **Per hosting service** (one tab per connected provider:
   GitHub.com, GitLab.com, Bitbucket.org, Azure DevOps, etc.,
   `getHostingServiceTabs` at `bundle:92376-92410`). Tab body shows the
   provider's repo list (org repos + own repos) for one-click clone.

For chajá v1, **only the URL tab is in scope**. Per-provider tabs are
SKIP — they require the cluster Integrations D3+ per-provider clients
(GitLab/Bitbucket/Azure DevOps) which are not landed yet, and tying
clone UX to that cluster blocks #100 unnecessarily. File a follow-up
issue once D3 lands.

## URL-tab field structure

Pulled from `bundle:209655-209720`. The form is wrapped by a tab
container `Fn.default` (`onboarding-clone-repo-tabs`) with header
"`1.` `<title>`" + "`2.` `<status>`".

| Section | Field | i18n key | Notes |
|---|---|---|---|
| URL | `RepoUrlInput` | `CloneRepo-RepoToCloneUrl` (`bundle:303543`) | Free text. SCP-style supported (`git@host:path`). |
| URL | `PathInput` (clone destination) | `CloneRepo-CloneDestinationPath` (`bundle:147450`) | Browse button via `makeOnBrowseForNewPath` (native picker). |
| Name | `RepoNameInput` (per `lr.default` at `bundle:209691`) | `CloneRepo-ClonedRepoName` (`bundle:260518`) | Pre-filled from URL via `gitUrlParse`. User-editable. |
| Settings | `CollapsibleShallowCloneSettings` (`bundle:209699`) | `CloneRepo-ShallowCloneToggle` (`bundle:59523`) | Collapsed by default. |
| Settings | `CollapsibleSparseCheckoutSettings` (`bundle:209702`) | `CloneRepo-SparseCheckoutToggle` (`bundle:208947`) | Collapsed by default. |
| Settings | `CloneSshSettings` (only when not URL tab) (`bundle:209707`) | `CloneRepo-CollapseSshSettings` / `CloneRepo-ExpandSshSettings` | Per-integration SSH key picker. SKIP v1. |
| Submit | `btn.btn-success` (`bundle:209714`) | `CloneRepo-CloneRepoButtonLabel` | Disabled until `go = isAbsolute(path) && (name || urlBaseName) && url && !shallowHasError`. |

The form's submit handler `ao` (`bundle:209623`):

```js
ao = (event) => {
  event.preventDefault();
  Dr(oa, aa || ct, ha, Ga, Ja, Ve);
  // Dr = onCloneRepository
  // oa = clonePath (resolved)
  // aa = repoName user-edited
  // ct = fallback name from gitUrlParse
  // ha = url
  // Ga = shallowCloneOptions
  // Ja = sparseCheckoutOptions
  // Ve = view (URL or hosting service type)
};
```

## SSH detection in URL tab

From `bundle:209606`:

```js
Ia = useMemo(
  () => ya === kr.URL && ha && "ssh" === An(ha).protocol,
  [ya, An, ha],
);
```

`An` is `gitUrlParse`. When detected as SSH (`git@host:path` or
`ssh://...`), the form renders `Dn.default` (`bundle:209705`) — an
inline LFS-and-SSH info banner. Real auth still goes through the global
SSH key flow, not surfaced inside the clone form for the URL tab.

## Submit-key handler

`yo = makeSubmitFormWithKeybind({ canSubmit: go, onSubmit: ao })` at
`bundle:209624`. Pressing Enter on URL/Path/Name inputs submits when
`canSubmit` is true (`bundle:209680-209691`).

## chajá field set for #100 v1

KEEP minimal:

```
URL                       (text input, required)
Destination path          (browse + text input, required)
Repository name           (text input, prefilled from URL last-segment, editable)
Recurse submodules        (checkbox, default ON, mirroring GK default ?? true)
[Optional collapsed pane] Clone depth (numeric input — shallow clone)
                          gix supports it via prepare_clone.with_shallow.

Submit: "Clone"           (i18n: CloneRepo-CloneRepoButtonLabel)
Cancel: "Cancel"
```

SKIP v1:

- Sparse checkout (gix support incomplete — defer to a separate issue).
- LFS init banner (chajá has no LFS support yet).
- Per-provider tabs (depend on D3+ per-provider clients).
- SSH-settings collapsible (depends on integration token storage path
  for SSH keys — out of scope).

FLAG:

- After v1, add a "Clone via [GitHub]" tab once D3 GitHubClient
  user-repos endpoint exists. That's a follow-up issue.

## Validation

| Field | Validation | Error display |
|---|---|---|
| URL | Non-empty + parsable by `gitUrlParse` (chajá: use `gix-url` crate). | Inline `dialog__error` below URL field. |
| Destination path | `path.isAbsolute()` checked (`bundle:209624`). chajá: same — gix needs absolute paths. | Inline below path field. |
| Repo name | Non-empty (defaults to URL last segment). | Inline below name. |
| Final clone target = path/name must NOT exist | Only checked at submit time (libgit2 / gix returns "destination exists"). | Toast on submit failure. |

## Cross-validation

```
$ grep -n "CloneRepo-CloneRepoButtonLabel" /tmp/gk-bundle-pretty.js
209717: }, ua("CloneRepo-CloneRepoButtonLabel")))), !sa && ya !== kr.URL
295236: }, ta("CloneRepo-CloneRepoButtonLabel"))));
$ grep -n "RepoToCloneUrl" /tmp/gk-bundle-pretty.js
100882: }, Ve || dt("CloneRepo-RepoToCloneUrl")), ln.default.createElement("input"
303543: label: zn("CloneRepo-RepoToCloneUrl"),
```

Both citations confirmed.

## chajá deviation FLAG

GK's URL tab title is "1. Clone with [URL/<provider>]" (`bundle:209654`)
because the form is part of a wizard with numbered steps. chajá runs the
form as a simple modal; we drop the "1." / "2." numbering and the wizard
chrome — render only the URL pane fields with a single header "Clone
repository".
