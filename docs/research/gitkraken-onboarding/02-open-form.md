# 02 — OnboardingOpenRepoForm

`bundle:96623` (definition starts ~ `bundle:96597`).

## What it renders

```
h3.ftux-stage-title            -> Ve("OnboardingOpenRepoForm-title")
div.text-secondary             -> Ve("OnboardingOpenRepoForm-desc")
.wizard-form-field
  span.mb2                     -> Ve("OnboardingOpenRepoForm-LocalPath")
  RepoPathSelector (jn.default at bundle:96631)
    placeholder                -> Ve("OnboardingOpenRepoForm-BrowseYourRepos")
    checkRepoValidity: true
    onPathChanged
    onPathKeyDown (Enter -> open if valid)
    onRepoPathsFound           -> selectedPathToSearchRepos UI value
    onSelectRepoFromMultipleReposClick
    searchReposInSubfolders: true
.mt3.flex.justify-end
  button.btn.btn-success       -> Ve("OnboardingOpenRepoForm-OpenTheRepo")
    disabled: !getCanOpenSelectedRepo(at)
    onClick: er  -> dispatch openRepoByPath(at.path)
```

`getCanOpenSelectedRepo(at)` returns `at?.path && !at?.error`
(`bundle:96598`). The form rejects paths whose validity check (libgit2
open) failed.

The right pane is decorative imagery: `OnboardingImgRelativePaths.openRepoKeif`
(`bundle:96649`).

## What chajá has today

`apps/chaja-app/src/components/ColdStart/index.tsx:14-21`:

```ts
async function openPicker() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open a Git repository",
  });
  if (typeof selected === "string") {
    setRecent(pushRecentRepo(selected));
    setRepoPath(selected);
    void openRepoInAnotherTab(selected);
  }
}
```

This calls `@tauri-apps/plugin-dialog`'s native directory picker. **No
custom dialog renders inside chajá.** The OS dialog handles browse +
selection, and on confirm chajá pushes to recents and opens.

## Gap analysis (chajá vs. GK)

| Behaviour | GK | chajá today | Triage |
|---|---|---|---|
| OS directory picker | yes (in `RepoPathSelector`) | yes (`@tauri-apps/plugin-dialog`) | **DONE** |
| Validate the picked path is a real git repo before opening | yes (`checkRepoValidity: true` at `bundle:96632`) | NO — chajá calls `setRepoPath` and the failure surfaces post-mount | **FLAG** |
| Auto-detect "this folder has multiple repos in it" + offer to pick one | yes (`searchReposInSubfolders: true` + `RepoPathSelector` invariant) | NO | **DEFER** (ChooseRepoForm-equivalent, doc 01) |
| In-app form rendering vs. native OS dialog only | GK renders an in-app form (so the user can see "validating…", retry, etc.) | chajá goes straight to native picker | **FLAG / minor** — chajá's UX is simpler; matches GK's spirit if we add validation feedback. |
| Path keyboard shortcut: Enter opens | yes (`onPathKeyDown`) | implicit (native dialog) | **DONE** (native dialog Enter = confirm) |

## Recommendations for chajá

### KEEP what chajá has

The OS picker is **simpler and faster** than GK's in-app form. Don't
replace it with a custom Solid component for the sake of 1:1.

### FLAG: pre-validate the path before `setRepoPath`

The current flow blindly calls `setRepoPath(selected)` and lets the rest
of the app display an error if the folder has no `.git`. Better:

1. Add a backend command `validate_git_repo(path: String) -> Result<(),
   BackendError>` that opens with gix and returns `RepoNotFound` /
   `RepoCorrupted` typed errors.
2. In `openPicker()`, call `validate_git_repo` before `pushRecentRepo` /
   `setRepoPath`. On error, toast + don't push to recents.

This is **NOT in #100 scope** unless we want to bundle it. Recommendation:
file as follow-up (`fix(coldstart): validate path before opening`),
keep #100 focused on Clone + Init.

### chajá deviation: skip the in-app OpenRepoForm

GK shows a stage with a search box and a button "Open the repo". chajá
opts for OS-native picker. **This is the right call for chajá** —
documented as deviation in `12-chaja-implementation-hints.md`.

## Cross-validation

```
$ grep -n "OnboardingOpenRepoForm-BrowseYourRepos" /tmp/gk-bundle-pretty.js
96637: placeholder: Ve("OnboardingOpenRepoForm-BrowseYourRepos"),
$ grep -n "getCanOpenSelectedRepo" /tmp/gk-bundle-pretty.js
96598: const getCanOpenSelectedRepo = Ve => Ve?.path && !Ve?.error;
96603: ... getCanOpenSelectedRepo(at) && dt((0, mn.openRepoByPath)(at.path))
```

Both citations confirmed.
