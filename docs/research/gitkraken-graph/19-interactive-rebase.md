# Interactive rebase

One of GitKraken Pro's hero features: dedicated UI for interactive
rebase (reorder / squash / fixup / drop / reword / edit). The bundle
shows a complete subsystem prefixed `PendingInteractiveRebase*` with
its own reducer, sagas, and React panel (`PendingInteractiveRebasePanel`).
Git operations are materialized in `rebase-merge/git-rebase-todo`
through a **shell script + custom client**
(`getGitSequenceEditorShellScriptPath`, `getGitSequenceEditorClientPath`)
that replaces the default Git editor to inject the todo from JSON.

Invocation modes, enumerated in `InteractiveRebaseMode`:
- `AiGenerateRebase` (index 0) — AI proposes the todo list.
- `CherryPick`
- `Rebase` (manual standard).

Valid steps in `rebaseOperations = Object.freeze({DROP:"drop",
PICK:"pick", REWORD:"reword", SQUASH:"squash"})`. Notable: **does NOT
expose `fixup`, `edit`, `exec`, `label`, `reset`, `merge`** from real
Git — GitKraken simplifies the set.

## Entry points

- Context menu on commit: `ContextMenu-StartInteractiveRebase` (label
  not directly located but the handler
  `PendingInteractiveRebaseStarted{rebaseSteps, mode, aiGeneratedShas}`
  implies it).
- Button in graph when an ancestor commit is selected.
- AI mode: "Generate" button fills `rebaseSteps` and fires
  `AiGenerateRebase`.

## Panel layout (`PendingInteractiveRebasePanel`)

- Vertical list of commits in the pending rebase.
- Each row: drag handle, action dropdown (pick / reword / squash /
  drop), editable summary.
- Multi-selection: `selectedShas` array, default `[Ve[0].sha]` (first
  commit selected).
- Reorder via `moveRebaseStepUp` / a Down equivalent (saga
  `ks.commandUp` / `commandDown`).
- Inline reword: state `ShaBeingRewordedUpdated{maybeSha, rewordMode}`.
  Modes: `RewordMode.POPOVER`, `RewordMode.DETAIL_PANEL`.

Panel header actions:
- "Start Rebase" (`PendingInteractiveRebasePanel-StartRebase`).
- "Start Cherrypick" (`PendingInteractiveRebasePanel-StartCherrypick`
  — reuses the same panel).
- "Update Message" (`PendingInteractiveRebasePanel-UpdateMessage`).
- Cancel / clear: `PendingInteractiveRebaseClearMode`,
  `ClearPerformedRebaseSteps`.

## Algorithm (pseudocode)

```
enterFlow(targetCommit, mode):
    rebaseSteps = listCommitsBetween(HEAD, targetCommit)
                    .map(c -> ({sha:c, type:"pick"}))
    dispatch(PendingInteractiveRebaseStarted(rebaseSteps, mode, aiGeneratedShas))
    if mode == AiGenerateRebase:
        runAiSuggester(rebaseSteps)
    showPanel()

userChangesAction(sha, newType):
    rebaseSteps[sha].type = newType   # pick | reword | squash | drop
    dispatch(PendingInteractiveRebaseStepsUpdated(rebaseSteps))

userReorders(sha, direction):
    moveRebaseStepUp(rebaseSteps, sha)  # or Down

userClicksStart():
    persistTodo(JSON.stringify(rebaseSteps), krakenInteractiveRebaseStepsFileName)
    spawn(handleGitRebaseStepsUpdateChannel)
    GIT_SEQUENCE_EDITOR = getGitSequenceEditorShellScriptPath
    GIT_SEQUENCE_EDITOR_CLIENT = getGitSequenceEditorClientPath
    git.rebase("-i", baseRef)
    onEachStep:
        if conflicts: handOffToConflictResolver()  # doc 18
        if reword: showRewordPopover()

onConflict:
    state.fileBeingResolved = ...
    user resolves (doc 18)
    dispatch(continueRebase)

continueRebase / abortRebase / skipStep:
    sagas continueRebaseWithCustomSteps / abortRebase / skipRebase
```

For squash / reword: `RebaseCommitStateUpdated{commitSha,
commitSummary, commitDescription}` updates the message live, and
`joinCommitMessage(summary, description)` concatenates it for git.

## Conflict handoff

When `git rebase` stops on a conflict, the detector reads the filesystem:

```
isGitRebaseInteractive(workdir):
    return exists(workdir/rebase-merge/drop_redundant_commits)
        or exists(workdir/rebase-merge/...)  # several markers
```

If interactive-in-progress: dispatch `GitInteractiveRebaseDetected(true)`
→ rehydrate the panel from `rebase-merge/git-rebase-todo` parsed,
mark current step with `RebaseStepsUpdated(currentStep, totalSteps)`,
and open the conflict resolver (doc 18) on the files in `MERGE_HEAD`.

`getCurrentRebaseStepMessages` and `getFriendlyRebaseStepInfo(Ve)`
expose friendly progress ("3 of 12: squash abc123").

## Continue / Abort / Skip / Undo

- `continueRebaseWithCustomSteps({repo, rebaseSteps, rebaseOptions,
  signature, squashResetTargetParentSha, squashResetTargetSha})` —
  saga that takes locks `[CONFIG, INDEX, REPO_SETTINGS]`, refreshes
  index, validates `hasConflicts`, and calls `repo.continueRebase`
  or the git binary.
- GPG support: if `gpgSignCommits && gpgCurrentKey`, uses
  `runNodeGitCallForSigning`.
- Post-rebase hook: `runPostRebaseHook(repo, finalSha)` when using the
  binary.
- Recovery from `corruptRebase`: saga `uncorruptRebase`.
- Auto-stash: `applyRebaseStash`, `dropCommitsWithPrompt`. If
  `RebaseRequiresStashAndCheckout` → shows
  `ConfirmationMessage-RebaseRequiresStashAndCheckoutPrompt`.
- Standard abort via libgit / git binary.

Undo of in-progress rebase: no magic undo. GitKraken uses auto-stash +
reset to the original `headRef` via
`PendingInteractiveRebaseStagedChangesDanglingCommitShaUpdated` which
preserves the pre-rebase sha.

## Yryvu implications

- **The `GIT_SEQUENCE_EDITOR = custom-binary` pattern is robust but
  requires a bundled binary.** In Rust / Tauri, build a sidecar binary
  that reads the rebase todo from stdin or a JSON file. `gix` does not
  yet have reliable interactive rebase, so falling back to the `git`
  CLI + sidecar editor is the pragmatic path.
- **Start with `pick / reword / drop / squash`** like GK; add `fixup`
  / `edit` later. SolidJS + `solid-dnd` for reorder is lightweight.
- **State fragmented by `Pending*` actions** makes undo / redo
  straightforward — replicate the pattern.
- **Conflict handoff is critical**. Interactive rebase without graceful
  conflict handling is unusable. Detect `rebase-merge/` on filesystem
  to re-enter the flow after a restart.

## Source locations

- `/tmp/gk-asar/src/render/static/entryPoints/main/render.bundle.js`
- Enums: `rebaseOperations = {DROP, PICK, REWORD, SQUASH}`,
  `InteractiveRebaseMode = {AiGenerateRebase, CherryPick, Rebase}`,
  `RewordMode = {POPOVER, DETAIL_PANEL}`.
- Actions: `PendingInteractiveRebaseStarted`,
  `PendingInteractiveRebaseStepsUpdated`,
  `PendingInteractiveRebaseClearMode`, `PendingInteractiveRebaseFinished`,
  `PendingInteractiveRebaseRefsUpdated{headRef, baseRef}`,
  `PendingInteractiveRebaseSelectedShasUpdated`,
  `PendingInteractiveRebaseOntoShaUpdated`,
  `PendingInteractiveRebaseMaybeParentShaUpdated`,
  `PendingInteractiveRebaseStagedChangesDanglingCommitShaUpdated`,
  `RebaseStepsUpdated{currentStep, totalSteps}`,
  `RebaseCommitStateUpdated`, `ClearPerformedRebaseSteps`,
  `GitInteractiveRebaseDetected`, `ShaBeingRewordedUpdated`,
  `UnsupportedRebaseDetected`, `RebaseFileLocked`.
- Sagas: `continueRebaseWithCustomSteps`, `runPostRebaseHook`,
  `applyRebaseStash`, `dropCommitsWithPrompt`, `corruptRebase`,
  `uncorruptRebase`, `isGitRebaseInteractive`, `moveRebaseStepUp`,
  `commandUp`, `commandDown`, `getCurrentRebaseStepMessages`,
  `getFriendlyRebaseStepInfo`.
- Plumbing: `getGitSequenceEditorShellScriptPath`,
  `getGitSequenceEditorClientPath`,
  `handleGitRebaseStepsUpdateChannel`,
  `krakenInteractiveRebaseStepsFileName`.
- Locks: `[CONFIG, INDEX, REPO_SETTINGS]`.
- UI: `PendingInteractiveRebasePanel`,
  `PendingInteractiveRebasePanel-StartRebase`,
  `PendingInteractiveRebasePanel-StartCherrypick`,
  `PendingInteractiveRebasePanel-UpdateMessage`,
  `ConfirmationMessage-RebaseRequiresStashAndCheckoutPrompt`,
  `StartRebaseButtonLabel`.
- AI: `AI_COMMIT_REBASE_FINISHED` metric, `aiGeneratedShas`.
