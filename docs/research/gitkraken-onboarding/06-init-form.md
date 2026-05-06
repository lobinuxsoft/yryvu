# 06 — InitRepoForm Local-tab fields + bootstrap saga

The Init form is multi-tab like Clone:

1. **Local** (`getLocalInitTab` at `bundle:92344`, view value
   `INIT_SUBVIEW_LOCAL`). i18n: `InitRepo-InitLocally`.
2. **Per hosting service** (one tab per connected provider). Tab body
   creates a repo on the host AND clones it locally — depends on
   integration tokens + provider repo-create endpoints. **SKIP for
   chajá.**

For #100 chajá renders only the Local body — no tab chrome, no
hosting-service tabs.

## Local-tab fields (`bundle:286032-286160`)

The Local body is rendered conditionally (`!lr` — only when not
init-from-hosting-service). Field set in render order:

| Order | Field | i18n key | Notes |
|---|---|---|---|
| (skipped on Local) | "Hosting service repo name" input | `InitRepo-HostingServiceRepoNameLabel` | Only renders when `lr` (initFromHostingService) — SKIP. |
| 1 | Path + Browse button | `InitRepo-CreateRepoTarget` (`bundle:63309`, `bundle:82105`) | Required. Must be `path.isAbsolute`. |
| 2 | Cloned repo name | `CloneRepo-ClonedRepoName` (`bundle:286058`) | On Local: rendered as static "<basePath>/<name>" string ONLY when `!lr` (`bundle:286076`). Editable when `lr`. **chajá deviation:** keep editable on Local too — that IS the new repo's directory name. |
| 3 | Default branch name | `InitRepo-DefaultBranchName` (`bundle:286081`) | Validated by `onValidateDefaultBranchRow` (`bundle:82175`): no spaces, valid as `refs/heads/<name>` after prefix check. Placeholder = git's default (typically `main`). |
| 4 | LFS init checkbox | `Lfs-InitializeWithLfs` (`bundle:286105`) | Only rendered if `isLfsInstalled`. SKIP v1. |
| 5 | GPG passphrase | `Gpg-Passphrase` (`bundle:286114`) | Only rendered if `signByDefault && !cachedGpgPassphrase`. SKIP v1. |
| 6 | .gitignore template picker | `InitRepo-GitIgnoreTemplate` (`bundle:286136`) | Dropdown. Source enumerated in doc 07. |
| 7 | License picker | `InitRepo-License` (`bundle:286144`) | Dropdown. `labelKey: "title"`, `valueKey: "key"`. Source enumerated in doc 08. |
| 8 | Submit button | `InitRepo-CreateRepoButtonLabel` (`bundle:286160`) | Disabled until path absolute + name non-empty + (no branch entered OR branch is valid). |

`onInitClick` signature (`bundle:82142`):

```js
onInitClick: (
  ignoreTemplate, // { value: <full path to template .gitignore> }
  license,        // { key: <license id>, ... }
  fullPath,       // string (basePath + sep + repoName)
  initWithLfs,    // boolean
  basePath,       // string (parent dir, separate from fullPath)
  passphrase,     // string | undefined
  branchName      // string (or default placeholder)
) => (event) => {
  event.preventDefault();
  const gitIgnorePath = ignoreTemplate?.value;
  const licenseKey   = license?.key;
  dispatch(createRepo({
    localPath: fullPath,
    noPrompt: true,
    gitIgnorePath,
    licenseKey,
    initWithLfs,
    passphrase,
    defaultBranchName: branchName,
  }));
  dispatch(setCurrentProfileSetting(["repoInit", "lastRepoInitPath"], basePath));
}
```

## `createRepo` saga (`bundle:202812-202866`)

The bootstrap sequence:

1. **Concurrency guard.** Bail if `getIsCreatingRepo` or
   `getIsCloningInProgress` already true.
2. **Reset transient state.** `FetchesReset`, `PushPromiseReset`,
   `MergeBranchNamesReset`, `RebaseHeadBranchShaReset` (`bundle:202833`).
   Mark `IsCreatingRepoUpdated(true)` and
   `TabSwitchBlockedByCreateRepoUpdated(true)`.
3. **GPG guard** (`bundle:202836`). When git-binary mode disabled, call
   `guardGpgSignMessage(passphrase, noPrompt)` to ensure signing is OK.
4. **Open or create repo at `localPath`.** `tryGetRepo(localPath,
   defaultBranchName)` (`bundle:202837`). If `localPath` already
   exists as a repo: open it. Else: `git init` + `setHead(refs/heads/
   <defaultBranchName>)`.
5. **Bootstrap files.** `setUpInitialCommitFiles(repo, gitIgnorePath,
   licenseKey)` (`bundle:202838`):
   - Always create `README.md` in workdir (`createReadMe`,
     `bundle:132606`).
   - If `licenseKey` and license has `contents`: write `LICENSE.md` with
     license-tag substitutions (year, holder).
   - If `gitIgnorePath`: copy from template path to
     `<workdir>/.gitignore` (chmod 0644 on Win32) (`bundle:132610`).
   - Stage all created files (`stagePaths`).
6. **Commit.** `doCommit(saga, repo, index, "Initial commit", true,
   passphrase)` (`bundle:202840`). Boolean true = sign if configured.
7. **Post.** `closeModal` -> `openRepoInSelectedTab(localPath)` -> if
   `initWithLfs`: spawn `initializeLfsRepository`. Emit `INIT_REPO`
   metric.

On error: toast `Error-CreateRemoteRepoFailed` (note: GK uses the
"remote" string for both local and remote create — `bundle:202856`)
with the err.message as content + telemetry message
`Error-CreateLocalRepoFailed`. **Inversion #2** caught: title and
telemetry-message keys differ in GK (Remote vs Local). chajá should
use the Local key for both since we don't do remote create.

## chajá field set for #100 v1

KEEP minimal:

```
Path                       (browse + text input, required, must be absolute)
Folder name                (text input — name of the new directory)
                            chajá deviation: editable on Local (GK only
                            renders editable when initFromHostingService)
Default branch name        (text input, validated, placeholder = git's
                            init.defaultBranch from gix config or "main")
.gitignore template        (dropdown, optional, "None" first option)
License                    (dropdown, optional, "None" first option)
Initialize with first commit (checkbox, default ON — chajá addition;
                            GK always commits if any template files exist)

Submit: "Create"           (i18n: "Create repository")
Cancel: "Cancel"
```

SKIP v1:

- LFS init checkbox.
- GPG passphrase row.
- Hosting-service tabs.
- Workspace-bound init.

FLAG:

- chajá addition: "Initialize with first commit" checkbox. GK ALWAYS
  commits if README/LICENSE/.gitignore are bootstrapped, but a user
  may want a fully empty repo (just `git init`). Add a checkbox
  defaulted ON. When unchecked, skip the `setUpInitialCommitFiles` +
  `doCommit` steps and only do `git init`.

## Validation rules

| Field | Rule | Source |
|---|---|---|
| Path | `path::is_absolute(path)` | `bundle:286043` (`_a = isAbsolute(Ea)`) |
| Folder name | non-empty trim | implicit from `va = lr && ct \|\| ha` (`bundle:286044`) |
| Default branch | no spaces + valid as `refs/heads/<name>` | `bundle:82175` (`onValidateDefaultBranchRow`) |
| Path + name combination must NOT be an existing non-empty git repo | only checked on submit (gix returns error) | post-validation toast |

## Cross-validation

```
$ grep -n "InitRepo-CreateRepoButtonLabel" /tmp/gk-bundle-pretty.js
286160: }, ya("InitRepo-CreateRepoButtonLabel"))) : void 0)
411758: } = this.props, Ia = gr || dt, wa = va(Ia ? "InitRepo-CreateRepoAndCloneButtonLabel" : "InitRepo-CreateRepoButtonLabel"), ...
$ grep -n "Error-CreateLocalRepoFailed" /tmp/gk-bundle-pretty.js
202858: telemetry: { message: "Error-CreateLocalRepoFailed" }
```

Both confirmed. Note the title/telemetry mismatch surfaced as Inversion
#2 above.

## chajá deviation FLAGs

1. **Folder-name input editable on Local.** GK only renders the input
   editable when initFromHostingService=true. chajá: always editable
   (mirrors how `mkdir <name> && cd <name> && git init` works).

2. **Optional first-commit checkbox.** chajá addition; GK has no toggle.
   Default ON to match GK's behaviour, but allow OFF for users who
   prefer fully empty repos.

3. **No LFS / GPG rows v1.** Both depend on profile settings GK ships
   that chajá hasn't built yet.
