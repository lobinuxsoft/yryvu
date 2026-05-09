# 10 — Post-clone / post-init recents integration

## GK behaviour

Both `cloneRepo` and `createRepo` sagas end with
`openRepoInSelectedTab(localPath)` (`bundle:188495` for clone-after-
prompt; `bundle:202841` for create). That call internally:

1. Loads repo data into the redux store.
2. Pushes the repo onto the **opened-repos list** for the current
   workspace (the `OPEN_REPOS_SECTION` of repo-management).
3. Triggers `loadRecentReposData` in the next refresh cycle, which
   adds the path to the `RECENT_REPOS_SECTION` (`bundle:86333-86344`).

GK's recents list is profile-scoped and stored in the user's redux-
persisted profile state. Cap is configurable per profile.

There is **no separate "add to recents"** call — opening the repo IS
what registers it. The recents list is the union of every path
`openRepoByPath` / `openRepoInSelectedTab` / `openRepoInAnotherTab` has
ever been called with, deduped by path.

## yryvu behaviour

`apps/yryvu-app/src/state/recent-repos.ts`:

- `pushRecentRepo(path)` -> stores `RecentRepo { path, name, openedAt
  }` in localStorage.
- `loadRecentRepos()` -> reads localStorage, sorts by `openedAt` desc.
- `removeRecentRepo(path)` -> removes from list.

The current call sites:

```ts
// ColdStart/index.tsx:17-20
setRecent(pushRecentRepo(selected));
setRepoPath(selected);
void openRepoInAnotherTab(selected);

// ColdStart/index.tsx:23-26 (recent click)
setRecent(pushRecentRepo(path));
setRepoPath(path);
void openRepoInAnotherTab(path);

// RepoManagement/index.tsx:104-110
pushRecentRepo(selected);
setRepoPath(selected);
void openRepoInAnotherTab(selected);
refreshKnownRepos();
```

Pattern: `pushRecentRepo` -> `setRepoPath` -> `openRepoInAnotherTab`.
**Three calls; explicit pushRecentRepo.** Different from GK's "opening
implicitly registers" approach.

## Recommendations for #100

KEEP the explicit `pushRecentRepo` pattern. Reasons:

1. The yryvu recents list is local-only (no profile sync). Explicit
   push is fine.
2. Centralising the push inside `openRepoInAnotherTab` would couple
   tab-ops to recents — bad layering. Today the recents push is a
   policy decision per call site, which is the right cut.

For new clone / init handlers, mirror the existing pattern:

```ts
// After successful clone:
const fullPath = `${dest}/${name}`;
pushRecentRepo(fullPath);
setRepoPath(fullPath);
void openRepoInAnotherTab(fullPath);
refreshKnownRepos(); // when called from RepoManagement context
closeDialog();

// After successful init:
const fullPath = `${basePath}/${folderName}`;
pushRecentRepo(fullPath);
setRepoPath(fullPath);
void openRepoInAnotherTab(fullPath);
refreshKnownRepos(); // when called from RepoManagement context
closeDialog();
```

The two openers (`ColdStart` and `RepoManagement`) need to differ on
the `refreshKnownRepos()` call — only RepoManagement keeps the cache
and needs the refresh; ColdStart unmounts as soon as the repo opens.

## Suggestion: open-after-clone prompt parity

GK pops a prompt after clone success: "Repository cloned. Open now?"
(`bundle:188505-188517`). yryvu can either:

A) **Skip the prompt** — auto-open in a new tab (matches the
   ColdStart pattern). UX is faster.

B) **Show the prompt** — gives the user the option to leave the new
   repo unfocused. Useful when bulk-cloning sequentially (rare in #100
   v1 since we don't bulk-clone).

**Recommendation: A (skip the prompt) for v1.** Matches yryvu's
existing post-Open pattern. Re-add the prompt as a follow-up if user
demand surfaces.

## Cross-validation

```
$ grep -n "openRepoInSelectedTab\|loadRecentReposData" /tmp/gk-bundle-pretty.js | head -5
86333: const ct = yield(0, hn.select)(Aa.getHiddenSectionById), dt = (Ve || ...
86344: ... yield(0, hn.put)((0, dr.IsLoadingReposSection)(!1, er.collapsibleSections.RECENT_REPOS_SECTION))
202841: yield mn.call(Zs.openRepoInSelectedTab, ln), ct && (yield mn.spawn(ds.initializeLfsRepository, zn))
```

Confirmed.
