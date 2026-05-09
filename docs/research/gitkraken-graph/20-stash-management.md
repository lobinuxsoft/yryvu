# Stash management

Stashes in GitKraken are first-class citizens: they appear as graph
nodes (not only in the sidebar) and participate in the ref model —
`stash@{N}` is resolved as a sha-like reference. The bundle exposes a
thin layer on top of `git stash`: `gkGit.stashPush`, `gkGit.stashApply`,
`gkGit.stashDrop`. The nodegit equivalent is `hn.default.Stash.drop`.
Sagas hold an explicit `[INDEX]` lock to avoid races with
commits / checkouts.

Notable: GitKraken uses stash internally as an **auto mechanism** for
complex operations (rebase, checkout with dirty tree, partial stage),
not just for user-initiated saves. Example: `autoStash` is invoked
during `RebaseRequiresStashAndCheckout` and restored afterwards.

## Surfaces

- **Sidebar**: dedicated "Stashes" section. Each item shows
  `stash@{N}` + message. Integrates with GitFlow via literal
  `gitflow-feature-stash` and friends.
- **Graph**: stashes are visible nodes. The reducer handles
  `stashConflictedSha` in the refs state. Edges to the base commit
  appear as a "stash" type.
- **Indicator**: stash counter in the topbar / sidebar header.

## Create stash

- Default action `stashPush` with options
  `{includeUntracked: bool, message: string, staged: bool}`.
- `staged: true` stashes only the index (equivalent to `--staged` in
  git ≥ 2.35).
- `includeUntracked: true` includes untracked files.
- **No `keepIndex` or `includeIgnored` option exposed to users** —
  GitKraken simplifies.
- Editable message, with AI helper: `FeedbackSourceAi.stashMessage`,
  `SettingAIKeys.stashMessage`. Preset constants:
  `stashMessages.FEATURE_STASH = "gitflow-feature-stash"`,
  `HOTFIX_STASH = "gitflow-hotfix-stash"`,
  `RELEASE_STASH = "gitflow-release-stash"` (GitFlow integration).

## Apply vs pop

- **Apply** is the dominant verb in code (`stashApply` appears dozens
  of times).
- "Pop" is implemented as **apply + drop atomically**, not as native
  `git stash pop`. Pattern seen:
  ```
  stashApply(repo, "stash@{N}", {index: true})
  stashDrop(repo, "stash@{N}")
  ```
- The UI default is "Apply" (more conservative). "Pop" requires a
  separate action `shouldDropStash: true` in
  `applyStashCriticalSection`.

## Drop

- `gitDropStashCriticalSectionSaga` takes the `[INDEX]` lock, calls
  `gkGit.stashDrop(opts, "stash@{N}")`.
- nodegit variant: `dropStashCriticalSection` with
  `hn.default.Stash.drop(repo, at)`.

## Content preview

On selecting a stash, GitKraken shows the diff vs WORKDIR of the base
commit. Reuses the Monaco diff editor and the file list. Stash paths
are resolved via `stash@{N}` as a pseudo-ref.

## Algorithm (pseudocode)

```
createStash(repo, message, includeUntracked, onlyStaged):
    locks: [INDEX]
    msg = message or imitateNodegitStashMessage(repo, options)
    result = gkGit.stashPush(repo, undefined, {
        includeUntracked,
        message: msg,
        staged: onlyStaged
    })
    if result == "No local changes to save":
        throw error
    sha = gkGit.getRefCommit(repo, "stash@{0}")
    refreshStashAndWorkDir()

applyStash(stashIndex, paths?, shouldDropStash):
    locks: [INDEX]
    stashRef = `stash@{${stashIndex}}`
    if paths:  # partial apply
        # GK doesn't expose this in UI but the saga supports it
        gkGit.restore(repo, paths, {source: stashRef, staged: true, worktree: true})
    else:
        gkGit.stashApply(repo, stashRef, {index: true})
    if conflicts in result.stdout includes "CON":
        markRepoAsConflict()
        state.stashConflictedSha = sha
    if shouldDropStash:
        gkGit.stashDrop(repo, stashRef)
    refreshStashAndWorkDir()

dropStash(stashIndex):
    locks: [INDEX]
    gkGit.stashDrop(repo, `stash@{${stashIndex}}`)

popStash(stashIndex):
    applyStash(stashIndex, undefined, shouldDropStash=true)
```

## Stash-to-branch

No literal `stash-to-branch` was found in the bundle. But the
combination `stashPush(staged:true) + stashApply(index:true) +
stashDrop` appears as a **partial commit recipe** (separating staged
from worktree). The equivalent of `git stash branch <name>` does not
appear to exist in the UI — the user must checkout + apply manually.

## Conflict handling on apply

If `stashApply` produces conflicts (detected by
`stdout.includes("CON")`), the repo enters conflicted state and the
flow hands off to the **Conflict Resolver (doc 18)**. The stash sha
is preserved (`stashConflictedSha`) for reference.

If the operation is cancelled ("cancelled" reason):
`getCancelledObject()` short-circuits the flow.

## Auto-stash in complex operations

`autoStash(repo, message)` is invoked before:
- Rebase with dirty workdir (`RebaseRequiresStashAndCheckout`).
- Checkout that would overwrite changes.
- Fast-forward operations with a dirty index.

After the operation: transparent apply + drop. If it fails → the
stash remains visible for recovery.

## Yryvu implications

- **Model stashes as first-class graph nodes** from day one:
  `enum GraphNode { Commit(Sha), Stash { sha, base, index, message } }`.
  Shoehorning a `is_stash: bool` on `Commit` later is technical debt.
- **Detecting conflict by `stdout.includes("CON")` is fragile** — if
  git is localised (`LANG=es`), it breaks. Force `LC_ALL=C` when
  spawning git, or check `MERGE_HEAD` post-op. Prefer the latter.
- **"Apply" as default is the right call** — protects users from
  accidentally losing their stash.
- **AI message generator is a secondary feature** — gate behind a
  flag.
- **Auto-stash is load-bearing** for rebase / checkout UX. Don't skip
  it when implementing those operations.

## Source locations

- `/tmp/gk-asar/src/render/static/entryPoints/main/render.bundle.js`
- API layer: `gkGit.stashPush`, `gkGit.stashApply`, `gkGit.stashDrop`,
  `gkGit.getRefCommit`, `gkGit.restore`, `hn.default.Stash.drop`.
- Sagas: `applyStashCriticalSection`,
  `gitApplyStashCriticalSectionSaga`, `dropStashCriticalSection`,
  `gitDropStashCriticalSectionSaga`, `imitateNodegitStashMessage`,
  `refreshStashAndWorkDir`, `autoStash`.
- Locks: `[er.INDEX]` for all stash ops.
- State: `stashConflictedSha`, `shasByFullName.MERGE_HEAD` (shared
  with merge), refs scope.
- Constants: `stashMessages.FEATURE_STASH`,
  `stashMessages.HOTFIX_STASH`, `stashMessages.RELEASE_STASH`
  (GitFlow), `prefixTypePrefix`, `stashesWithIndex` (CLI generator).
- Error strings: `"No local changes to save"`, `"CON"` substring
  detection for conflicts.
- AI: `FeedbackSourceAi.stashMessage`, `SettingAIKeys.stashMessage`.
- CLI integration (autocomplete): `Cli-GitStashListDescription`,
  `Cli-GitStashDropDescription` (quiet flag `-q/--quiet`).
- Apply payload:
  `{paths, repo, repoWorkDir, repoPath, shouldDropStash, stashIndex, stashMessage}`.
