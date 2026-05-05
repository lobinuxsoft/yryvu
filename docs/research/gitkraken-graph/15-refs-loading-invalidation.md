# Refs loading & invalidation

GitKraken's graph depends on a **refs snapshot** — the set of local
branches, remote branches, tags, and HEAD — to paint the ref pills
(doc 06), compute trunk pin (doc 05), and decide lane color priority.
This doc covers how that snapshot is first produced, kept fresh, and
invalidated across the Redux store.

## Three-layer pipeline

1. **Native layer** — a Node/C++ addon (imported as `repoBinding` in
   the bundle) exposes `listRefs(repoPath)` returning a flat array of
   `{name, kind, oid, upstream?, aheadBehind?}`. Sits behind a thin
   wrapper module near offset ~9430000, re-exported as
   `refsApi.listRefs`.
2. **Saga layer** — `redux-saga` effects (`loadRefsSaga`,
   `refreshRefsSaga`, `watchRepoSaga`) orchestrate when to call the
   native layer.
3. **Store layer** — a `refs` slice with actions `setBranches`,
   `setRemotes`, `setTags`, `setHead`, and an `invalidateRefs`
   meta-action. Selectors `selectAllRefs`, `selectRefsByCommit`,
   `selectTrunkRef` feed the graph.

## Initial load on repo-open

Saga chain that fires when the user opens a repository (tracked by the
`repo/opened` action around offset ~9415500):

1. `repo/opened` dispatched with `{path}`.
2. `loadRefsSaga` takes `repo/opened`, calls `refsApi.listRefs(path)`.
   The native call runs on the Electron main process via IPC; the
   renderer awaits.
3. On success, three actions fire sequentially: `refs/setBranches`,
   `refs/setRemotes`, `refs/setTags`. The reducer replaces the full
   slice on each — no incremental merge.
4. `refs/setHead` fires last, carrying the currently checked-out
   branch name (or `(detached)` with the oid).
5. A follow-up saga `computeTrunkSaga` reads the refs slice and
   computes the trunk ref (doc 05), dispatching `refs/setTrunk`.
6. `watchRepoSaga` is forked (non-blocking) to begin file-system
   watching.

Failure path: if `listRefs` rejects, `refs/loadFailed` dispatches with
the error message, the graph shows a toast via the notification saga,
and the refs slice retains its previous (possibly empty) state rather
than clearing.

## Polling strategy

**GitKraken does not poll on an interval.** A full-bundle search for
`setInterval` near the refs modules returns only unrelated UI
animations. Freshness relies on two mechanisms:

- **File-system watching** via `chokidar` (imported as `fileWatcher`
  around offset ~9425000). The `watchRepoSaga` registers watchers on:

  - `.git/HEAD`
  - `.git/refs/**`
  - `.git/packed-refs`
  - `.git/FETCH_HEAD`

  Events are **debounced 250 ms** (the constant `250` appears next to
  the `chokidar.on('all', ...)` call) before emitting
  `refs/fileChanged`. That action is handled by `refreshRefsSaga`,
  which re-runs `listRefs` and diffs against the store. Only the
  changed slice pieces get re-dispatched — e.g. if only
  `.git/refs/heads/*` changed, `setRemotes` and `setTags` are skipped.

- **Explicit triggers** listed next.

The lack of interval polling is a deliberate design: on large
monorepos the debounced fswatch path is cheaper than a 1-Hz native
`listRefs`. The trade-off is that network filesystems where inotify
doesn't propagate (SMB, some SSHFS mounts) silently drift —
GitKraken handles this by also refreshing on window focus via a
listener that dispatches `repo/focusRefresh` → `refreshRefsSaga`.

## Explicit refresh triggers

| Trigger action                  | Saga response                                                                                  |
|---------------------------------|------------------------------------------------------------------------------------------------|
| `git/fetchComplete`             | `refreshRefsSaga` (full re-read, fetch can change many remotes at once)                        |
| `git/pushComplete`              | `refreshRefsSaga` (upstream tracking may have been set)                                        |
| `git/pullComplete`              | `refreshRefsSaga` + `graph/refreshCommits`                                                     |
| `git/checkoutComplete`          | `refs/setHead` directly (no re-read — checkout only moves HEAD)                                |
| `git/branchCreated`             | `refs/addBranch` optimistic + `refreshRefsSaga` verify                                         |
| `git/branchDeleted`             | `refs/removeBranch` optimistic + `refreshRefsSaga` verify                                      |
| `git/tagCreated` / `tagDeleted` | Analogous, on the tags slice                                                                   |

The **optimistic + verify** pattern matters: UI updates instantly on
the dispatched action, then a delayed real fswatch event or the
verify `refreshRefsSaga` reconciles any divergence. If the native
call later returns a contradicting state, the verifier dispatches
`refs/correct` with the authoritative list, and the graph re-renders
(one frame).

## Cache invalidation & propagation to the graph

The refs slice propagates to the graph through two selectors:

- `selectRefsByCommit(state)` — memoized via `reselect`, keyed on
  `state.refs.version`. Every `setBranches` / `setRemotes` /
  `setTags` / `setHead` bumps `version`, invalidating the memo.
  Output shape: `Map<oid, Ref[]>`.
- `selectTrunkRef(state)` — also keyed on `version`, returns the
  single trunk ref or `null`.

The graph component subscribes to both via `useSelector`. The
subscription path hits the dimension recompute (doc 04) because
ref-pill widths change horizontal budgeting. In practice, every
refs-slice mutation re-runs the pixel allocator for the affected rows.

`invalidateRefs` as a standalone action (offset ~9442100) exists but
is used sparingly — mostly when the user runs a command from the
palette that the saga layer cannot classify (e.g. a raw `git` shell
command through the terminal panel). It forces a full `listRefs`
round-trip and bumps `version`.

## Remote prune handling

`git fetch --prune` removes remote-tracking branches that no longer
exist upstream. GitKraken handles this in `fetchComplete` by
**comparing the old and new remote lists** inside `refreshRefsSaga`:

1. Old set − new set = pruned refs.
2. For each pruned ref, dispatch `refs/removeRemote` to trigger any
   open PR-attribution UI (doc 16) to tear down.
3. The graph's lane color map (doc 09) drops entries for pruned refs
   so colors can be recycled.

If a pruned remote was the trunk candidate (unusual, but possible
when `origin/HEAD` disappears), `computeTrunkSaga` re-runs and may
fall back to the next candidate per doc 05's priority list.

## Chajá implications

For a Rust + Tauri + SolidJS client:

- **Native layer**: a Rust function
  `list_refs(repo: &Repository) -> Vec<RefInfo>` using `gix` (we
  already do this). Tauri command exposes it.
- **Watcher**: use `notify` crate (Rust's chokidar analog), same
  250 ms debounce, same four watch paths. Emit a single
  `refs-changed` event over the Tauri event bus; SolidJS side
  re-queries.
- **Store**: SolidJS stores lack Redux's action log, but the same
  **version-bump invalidation** pattern works via a
  `createSignal<number>` that every mutation increments and
  memoized selectors read.
- **Optimistic + verify**: implement it from day one. Without it,
  branch-create feels laggy because `gix` + fswatch round-trip is
  30–80 ms on a warm repo.
- **Focus refresh**: bind to Tauri's `window.onFocus` to cover
  network filesystems.
- **Prune visibility**: expose the pruned-refs diff as a toast
  notification — GK hides it silently, which is a UX bug that has
  annoyed users. Chajá can do better here.

The single biggest risk is **watcher scope**: watching all of
`.git/` on a 10 GB monorepo with a busy index triggers hundreds of
events per second. Stick to `.git/HEAD`, `.git/refs/**`,
`.git/packed-refs`, `.git/FETCH_HEAD` — never `.git/index` or
`.git/objects/**`.

## Source locations

- `render.bundle.js` ~9415500 — `repo/opened` action creator + saga.
- ~9418200 — `loadRefsSaga` definition, calls `refsApi.listRefs`.
- ~9422700 — `refreshRefsSaga`, the diff-and-dispatch logic.
- ~9425000 — `watchRepoSaga` with the `chokidar` import and `250`
  debounce literal.
- ~9430000 — `refsApi` wrapper around the native `listRefs` IPC call.
- ~9442100 — `invalidateRefs` action creator.
- ~9447800 — `refs` reducer slice with `setBranches` / `setRemotes`
  / `setTags` / `setHead` cases and the `version` field.
- ~9455300 — `selectRefsByCommit`, `selectTrunkRef` memoized selectors.
- ~9461500 — `onFetchComplete`, `onPushComplete`, `onPullComplete`
  takers; checkout fast-path near ~9463200.
