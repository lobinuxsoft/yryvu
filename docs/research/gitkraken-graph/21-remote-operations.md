# Remote operations — push / pull / fetch

Remote synchronisation is the one place where local Git state touches a
network that can fail for a thousand reasons. GitKraken treats push,
pull and fetch as three first-class sagas orchestrated from the Redux
layer, each with its own pre-flight prompts, progress surface, error
triage, and post-operation graph refresh. Unlike `git(1)` which is a
blocking CLI, GitKraken keeps the UI responsive while a long-running
libgit2 / child-process call is in flight, and degrades gracefully when
authentication is demanded mid-operation. The bundle exposes a
dedicated background loop for `autoFetch` in addition to the explicit,
user-triggered flows.

## Entry points

The toolbar owns the visible affordances: `ToolbarPullButton`,
`ToolbarGitActions`, `ToolbarGlobalActions` expose Pull, Push and Fetch
as dedicated buttons (plus LFS variants via `ToolbarLfsButton`). Each
button is split in two: a primary click runs the default, a dropdown
arrow opens the options sub-menu (force push, prune, set upstream,
etc.). The same verbs also live in the branch context menu of the left
panel and the graph row context menu, reusing the same saga entry
points. `CommitButtonLabelPushSuffix` combined with
`DefaultPushAfterCommit` and `CommitButtonLabelCheckboxPushAfterCommitting`
prove that the commit dialog has an inline checkbox that chains a push
immediately after committing via `commitAndPushSaga`.

## Options dialogs

Force push is the most guarded flow in the bundle. Two-step
confirmation: `ConfirmForcePushPrompt` raises `promptConfirmForcePush`
or `promptConfirmForcePushWithLease`, both routed through
`handleForcePushPromptsWithLeaseSaga` /
`handleForcePushPromptsWithOutLeaseSaga`. A user setting
`forcePushSkipSecondWarning` (getter `getForcePushSkipSecondWarning`)
lets advanced users collapse the second dialog. Labels
`ForcePushWithLeaseButtonLabel` / `ForcePushWithoutLeaseButtonLabel`
confirm both semantics are distinct options.

Upstream selection: `promptSetUpstreamForRef` / `branchSetUpstream`.

Fetch options: `autoPrune`, `pruneTags`, tag-pull flags tied to
`GitFetchPruneDescription` / `GitFetchPruneTagsDescription`.

Azure DevOps adds a special guard `MissingAzureDevopsForcePushPermission`
because that provider blocks force push at the server level.

## Progress reporting

Dual-channel. While an op runs, an inline progress bar is driven by
libgit2 transfer callbacks (`GitPushProgressDescription`,
`GitPullProgressDescription`, `GitFetchprogressDescription`). On
completion a toast fires: `showPushSuccessToastSaga` /
`showPushFailureToastSaga` for user-triggered pushes, and generic
`itReposRemoteActionSucceedToastSaga` / `itReposRemoteActionFailedToastSaga`
for batched remote actions. The `fetch_in_progress` flag guards
re-entry.

## Cancellation and background

`cancelledDueToConcurrentFetch`, `fetchAborted`, `fetchAbortIgnored`,
`allowStaleOnFetchAbort`, `allowStaleOnFetchRejection` describe a
cancellation model where a new fetch can pre-empt an in-flight one,
and where "stale" cached data is acceptable when the user navigates
away. `autoFetchSaga` / `startAutoFetchSaga` / `stopAutoFetchSaga` /
`updateAutoFetchSaga` drive a timer controlled by `autoFetchInterval`
with `autoFetchHiatusUntil` backing off after errors.
`backgroundFetch` and `batchFetch` are the non-user-blocking variants.

## Error handling

Push failure specialises on `PushFailedNoRemote` and
`PushFailedWithName`, then branches to the force-push prompts for
non-fast-forward rejections (`needsForcePush` / `shouldForcePush`).
Auth failure funnels into the credential layer (doc 22) rather than
showing a plain error. Pull merge conflicts hit
`detectMergeConflictSaga` / `MergeConflictDetected`, which opens the
conflict resolution UI (doc 18) and pauses the pull.
`isMergeConflictOrUnsupportedRebase` differentiates genuine conflicts
from rebase-abort states.

## Multi-remote handling

`getPushToRemotes`, `getPushUrlsByRemoteName`,
`getRemoteNamesByFrecencyScore`, `SetRemoteUpstreamFrecencyConstants`
show that when a repo has several remotes, GitKraken orders them by
frecency (frequency plus recency) in the picker, and
`anyRemoteSilentFetchFailed` tracks per-remote errors silently so one
broken remote does not abort the whole repo.

## Post-operation refresh

`refreshCommits` / `refreshCommitsSaga` are dispatched after every
successful push / pull / fetch to rebuild the graph (see doc 15).
`refreshBatch` / `refreshBatchCount` / `refreshBatchPeriod` throttle
repeated refreshes when several remote ops finish in quick succession.

## Algorithm (pseudocode)

```
saga onUserPushClick(ref):
    opts = readPushOptionsFromDialog()
    if opts.force:
        if not forcePushSkipSecondWarning:
            if !await handleForcePushPromptsWithLease(ref): return
    if not hasUpstream(ref) and opts.setUpstream:
        await promptSetUpstreamForRef(ref)
    startPushProgress(ref)
    try:
        result = libgit2.push(ref, opts, credentialCb)
    catch AuthError:      yield to credential saga (doc 22), retry
    catch NonFastForward: suggest forcePushWithLease
    catch NetworkError:   showPushFailureToastSaga; return
    showPushSuccessToastSaga(result)
    dispatch refreshCommits(repo)
```

## Chajá implications

- **Cancellable Tauri commands** emit progress events the frontend
  subscribes to.
- **Non-fast-forward should not auto-retry with `--force`**; emit a
  typed error (`RemoteError::NonFastForward`) that the SolidJS layer
  maps to a guarded dialog.
- **Borrow the two-step force-push confirmation** and the "skip second
  warning" toggle for advanced users — that pattern is what keeps
  GitKraken out of support tickets.
- **Plan auto-fetch with a back-off timer** (`autoFetchHiatusUntil`
  equivalent) from day one; otherwise one offline repo poisons every
  N-second tick.
- **Frecency ordering for multi-remote pickers** — same two-axis
  frecency used in doc 23's fuzzy finder.

## Source locations

- `/tmp/gk-asar/src/render/static/entryPoints/main/render.bundle.js`
- Symbols: `ToolbarPullButton`, `commitAndPushSaga`,
  `ConfirmForcePushPrompt`, `promptConfirmForcePush`,
  `promptConfirmForcePushWithLease`, `handleForcePushPromptsWithLeaseSaga`,
  `handleForcePushPromptsWithOutLeaseSaga`,
  `ForcePushWithLeaseButtonLabel`, `ForcePushWithoutLeaseButtonLabel`,
  `forcePushSkipSecondWarning`, `needsForcePush`,
  `promptSetUpstreamForRef`, `branchSetUpstream`, `autoPrune`,
  `GitFetchPruneDescription`, `GitFetchPruneTagsDescription`,
  `GitPushProgressDescription`, `GitPullProgressDescription`,
  `showPushSuccessToastSaga`, `showPushFailureToastSaga`,
  `fetchAborted`, `fetchAbortIgnored`,
  `cancelledDueToConcurrentFetch`, `autoFetchSaga`, `backgroundFetch`,
  `PushFailedNoRemote`, `detectMergeConflictSaga`,
  `getRemoteNamesByFrecencyScore`, `anyRemoteSilentFetchFailed`,
  `refreshCommitsSaga`, `MissingAzureDevopsForcePushPermission`,
  `lfsPush`, `lfsPull`, `lfsFetch`.
