# Conflict resolver (3-way merge UI)

GitKraken never exposed a manual conflict editor in the VSCode
`<<<<<<< HEAD` style. Instead it has a dedicated panel built on
**Monaco DiffEditor** plus Redux state for the diff3 (ours / base /
theirs). The bundle reveals a whole module around `diff3ByPath`,
`conflictIndex`, `fileBeingResolved`, and an AI assist
(`aiMergeSummaryByPath`, `Diff3PreAiResolutionByPath`).

The conflicted-file detector lives in Redux: `MergeResultDetected`
with payload `{ourCommitSha, theirCommitSha, hasMergeConflict,
conflictedFilePaths}`. Results are cached per `${ourSha}-${theirSha}`
pair with `makeCacheQueuePush(100)`.

## Surface & UI

Conflict surfaces:
- In the uncommitted file list there's a dedicated
  `UncommittedFileList-ConflictedFilesTitleSummary` section (separate
  from staged / unstaged / unconflicted).
- Group action `MarkAllResolved` which dispatches
  `stagePaths(ct[types.CONFLICT])` and records a
  `CONFLICT_MARKED_ALL_RESOLVED` metric.
- Folder context menu: `markConflictedFilesAsResolved` with label
  `Folder-MarkConflictedFilesAsResolved`.

Editor:
- Monaco `editor.createDiffEditor`, configured with `renderSideBySide`
  when `fileDisplayMode === Xr` (three modes: `Zr`, `ta`, `Xr` —
  split / inline / 3-pane).
- Per-side header built by
  `returnHeaderObject(isBranch, hasCommit, name, commit)`. The state
  keys `mergeHeader[Dn]` and `mergeHeader[Fn]` represent the two sides
  (ours / theirs).
- Conflict navigation: `goToNextConflict`, `goToPreviousConflict`,
  indicator `conflictIndex`.
- AI integration: `AiMergeSummarySet` and `Diff3PreAiResolutionSet`
  let the user accept / reject a suggested resolution.
  `FeedbackSourceAi.conflictResolution` for telemetry.

Per-hunk accept: implicit via Monaco — the user edits the "modified"
panel directly. Individual hunks don't have "accept theirs" /
"accept ours" buttons like GitLens. Granularity is the whole file,
marked resolved on save and stage.

## Algorithm (pseudocode)

```
on conflictDetected(filesByPath):
    state.conflictedFilePaths = filesByPath
    cacheQueue.push(`${ourSha}-${theirSha}` -> result)
    showSection("conflicted")

on selectConflictedFile(path):
    state.fileBeingResolved = path
    state.conflictIndex = 0
    diff3 = parseFromGitMarkers(workdir/path)
    state.diff3ByPath[path] = diff3

on userEditsModifiedPanel(newContent):
    writeToWorkdir(path, newContent)
    if not containsMarkers("<<<<<<<", "=======", ">>>>>>>"):
        enable("MarkResolved")

on markResolved(path):
    dispatch(stagePaths([path]))
    state.fileBeingResolved = nextConflictedFile()

on continueMerge():
    if remainingConflicts == 0:
        gitCommit(autoMergeMessage)

on abortMerge():
    gkGit.merge.abort()  # clears MERGE_HEAD
```

Storage format: the on-disk file keeps the standard Git markers
(`<<<<<<<`, `=======`, `>>>>>>>`) until the user replaces them with
clean content. Monaco doesn't inject anything exotic — it writes the
buffer as-is.

## External mergetool

`foundMergeTools` and `foundDiffTools` are detected on repo open
(handlers `FoundMergeToolsUpdated` / `FoundDiffToolsUpdated`).
`normalizeMergeToolLabel(Ve)` translates the `git config merge.tool`
value to a visible label (`gitConfigDefault -> "ExternalMergeTool"`).
The user can launch p4merge / kdiff3 / etc. from the conflicted-file
menu. Validation error key: `INVALID_PARAMETER_MERGETOOL_FRAME`.

## Continue / Abort

- `MERGE_HEAD` is tracked at `shasByFullName.MERGE_HEAD` in state.
- `updateMergeHead` saga calls `repo.getBranch("MERGE_HEAD")`; on
  failure → `MergeHeadUpdated(null, null)`.
- Error string: `CANNOT_GET_MERGE_HEAD = "Cannot get merge head when
  repo is not in merge state"` if invoked without an active merge.
- Abort: `mergeAbort` (exported by the merge sagas module:
  `at.mergeAbort = at.merge = at.makePerformMergeCommit = ...`).

## Chajá implications

- **Monaco is heavy** (~3 MB JS). For a Tauri app, lazy-load it only
  when a conflict exists, or replace with CodeMirror 6 (modular) or a
  hand-rolled SolidJS editor plus a pure `diff3` library.
- **Replicate the state shape** (`diff3ByPath` / `conflictIndex` /
  `fileBeingResolved`). It gives clean UX, per-file progress, and is
  easy to serialize for resume.
- **AI assist can be gated behind a feature flag** — skip initially.
- **Marker parser is ~50 lines of Rust**, no libgit2 involvement
  needed: split the file on `<<<<<<<`, `=======`, `>>>>>>>` lines.
- **Preserve git markers on disk.** Don't invent a Chajá-specific
  format — interoperability with git CLI + other tools matters.

## Source locations

- `/tmp/gk-asar/src/render/static/entryPoints/main/render.bundle.js`
- State actions: `MergeResultDetected`, `ShowConflictedFilesUpdated`,
  `ConflictIndexSet`, `Diff3Set`, `Diff3PreAiResolutionSet`,
  `AiMergeSummarySet`, `GenerateDiff3Succeeded`, `mergeHeader`,
  `fileBeingResolved`, `aiMergeSummaryByPath`, `diff3ByPath`,
  `conflictIndex`.
- UI symbols: `goToNextConflict`, `goToPreviousConflict`,
  `markConflictedFilesAsResolved`, `MarkAllResolved`,
  `UncommittedFileList-ConflictedFilesTitleSummary`,
  `Folder-MarkConflictedFilesAsResolved`.
- Monaco: `getMonaco().editor.createDiffEditor`, `buildDiffOptions`,
  `renderSideBySide`, `goToDiff("next"|"previous")`, `revealFirstDiff`,
  `containersByFileDisplayMode[Zr|ta|Xr]`.
- Git layer: `mergeAbort`, `mergeResolve`, `MERGE_HEAD`,
  `updateMergeHead`, `mergeheadForeach`, `CANNOT_GET_MERGE_HEAD`,
  `COULD_NOT_MERGE_BRANCHES`, `MergeConflictStashAndCheckoutPrompt`.
- Mergetool: `FoundMergeToolsUpdated`, `FoundDiffToolsUpdated`,
  `normalizeMergeToolLabel`, `INVALID_PARAMETER_MERGETOOL_FRAME`,
  `configuredMergeTool`.
- Telemetry: `oTelMetrics.CONFLICT_MARKED_ALL_RESOLVED`,
  `FeedbackSourceAi.conflictResolution`.
