# 01 — OnboardingChooseRepoForm (folder scanner)

`OnboardingChooseRepoForm` is the form that misled the issue body. It is
NOT the "what would you like to do" picker; it is a **batch-scan** UI
that walks a chosen parent directory and lists every git repo found
underneath, letting the user pick one.

## Where it renders

`bundle:294760` (definition) is rendered inside the FTUX wizard once
the user has been onboarded but has no opened repo yet. The component
does:

```
h3.ftux-stage-title           -> Ve("OnboardingChooseRepoForm-title")
div.form-desc                 -> Ve("OnboardingChooseRepoForm-desc")
toolbar.onboarding-choose-repo-toolbar
  $n searchbox (autoFocus)    -> Ve("RepoManagement-searchRepositories")
  er spinner                  -> Ve("RepoPathSelector-ScanningForRepositories") (when scanning)
lr (RepoListByPath)           -> rendered table of found repos
footer.onboarding-choose-repo-footer
  zn button "watch video"     -> Ve("OnboardingChooseRepoForm-watchVideo")
  separator "|"
  zn button "view docs"       -> Ve("OnboardingChooseRepoForm-viewDocs")
```

(Source: `bundle:294762-294790`.)

## What it does

The form reads two redux selectors:

- `getOnboardingSelectedPathToSearchRepos` (`bundle:294744`) — the user-
  picked parent directory to scan.
- `getIsRepoSelectorScanningReposByPath` (`bundle:294743`) — boolean
  scanning indicator.

When the user picks a folder via the search box, GK dispatches
`UiValueChanged(["onboarding", "selectedPathToSearchRepos"], path)` and
fires the `FOLDER_CONTAINING_MULTIPLE_REPOS_OPENED` event for telemetry
(`bundle:96617`).

The found-repos table (`lr` at `bundle:294776`, module 61180) renders
columns:

```
renderHeader: ct("OnboardingChooseRepoForm-repoName") (bundle:231787)
renderHeader: ct("OnboardingChooseRepoForm-repoPath") (bundle:231799)
```

Selecting a row dispatches `openRepoByPath(repoPath)` (`bundle:231779`).

## Triage: SKIP / defer

This form **is not in #100 scope**. Reasons:

1. The acceptance criteria of #100 are 3 dialogs (Open / Clone / Init).
   ChooseRepoForm is a 4th surface, not on the list.
2. chajá's `RepoManagement` permanent tab already handles the use case
   the ChooseRepo form addresses ("I have a folder with many repos, let
   me pick one"). RepoManagement lists known repos (recents), not
   filesystem-scanned ones, but the user can scan with their OS file
   manager and Open from there.
3. The "scan a parent folder for nested git repos" feature is a real UX
   win, but it requires backend support (`scan_for_repos(parent_path)`)
   that is not part of #100. Defer to a follow-up issue if user demand
   surfaces.

## What chajá needs from this form: NOTHING for #100

The strings (`OnboardingChooseRepoForm-title`, `-desc`, `-watchVideo`,
`-viewDocs`) are not reused.

## Follow-up issue suggestion (do NOT file in this PR)

> **feat(repo-management): scan parent folder for nested git repos.** Add
> a backend `scan_for_git_repos(path)` that walks `path` to a configurable
> depth, returning `Vec<{ path, name }>` for any directory containing
> `.git`. Wire a "Scan folder…" button into RepoManagement that uses the
> directory picker, then renders the result as a checkbox table where the
> user can multi-select and `openRepoInAnotherTab` each.

That issue is NOT a #100 sub-issue. Mention it in the PR body so the
maintainer can decide whether to file separately.

## Cross-validation

Re-grepped:

```
$ grep -n "OnboardingChooseRepoForm-title" /tmp/gk-bundle-pretty.js
294760: }, Ve("OnboardingChooseRepoForm-title")), ...
$ grep -n "OnboardingChooseRepoForm-repoName" /tmp/gk-bundle-pretty.js
231787: ... ct("OnboardingChooseRepoForm-repoName")), ...
```

Both citations check out.
