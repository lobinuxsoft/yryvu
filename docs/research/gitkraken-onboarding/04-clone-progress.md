# 04 — Clone progress reporting + cancel UX

## GK progress pipeline

The clone saga (`bundle:188529-188707`) runs in two backend modes:

1. **Git binary mode** (`isGitBinaryEnabled` selector). GK shells out to
   the system `git` binary. Progress is forwarded verbatim from the
   binary's stderr parser (`bundle:188467`):

   ```js
   const { progress: at } = ct;
   yield call(Dr.default, cloneRepoIpcMessageChannels.CLONE_REPO_PROGRESS_UPDATED,
             clonePath, at);
   ```

2. **nodegit / libgit2 mode** (default). The `cloneProgressEmitter` is
   wired to libgit2's `transfer-progress` callback. Stats arrive as
   `{ receivedObjects, indexedObjects, totalObjects }`. Percent
   computed (`bundle:188471`):

   ```js
   const { stats: at } = ct;
   const dt = 100 * (at.receivedObjects() + at.indexedObjects())
            / (2 * at.totalObjects());
   ```

   Average of the two phases (download + index), range 0..100. The
   computation **counts indexedObjects toward overall progress**, so
   the bar only reaches 100 after libgit2 finishes indexing (post-
   download).

3. **Throttling** differs per mode:
   - Binary mode: `_.throttle(100, cb)` (`bundle:188559`). 100 ms.
   - nodegit mode: `_.throttle(500, cb)` (`bundle:188488`). 500 ms.

## IPC channels

`cloneRepoIpcMessageChannels` exports three:

```
CLONE_REPO_STARTED            -> emit on saga entry (bundle:188552)
CLONE_REPO_PROGRESS_UPDATED   -> emit on each throttled stats sample
CLONE_REPO_FINISHED           -> emit in `finally` block (bundle:188480)
```

## Toast UX during clone

(`bundle:188551-188559`)

```js
Ea = yield call(showToast, {
  variant: toastVariants.LOADING,
  title: ga("Notification-CloningToPath", clonePath),
  content: <CloneTransferProgressBar />,  // module la at bundle:188549
  dismissable: false,
  duration: TOAST_DURATION_FOREVER,
});
```

So during clone:

- A **loading toast** is open (not dismissable, no auto-timeout).
- Toast title = `"Cloning to <path>"`.
- Toast content = a progress bar component reading the same emitter.
- Cancel UX: there is **no in-toast cancel button**. The user can only
  dismiss the modal that submitted the clone, but **the saga keeps
  running** until completion (libgit2 has no clean cancel API for
  in-flight `Clone.clone`).

## On success

Saga emits `CLONE_REPO_FINISHED`, then prompts (`bundle:188505`):

```js
makeConfirmPrompt({
  id: "CloneSuccessPrompt",
  message: ga("CloneRepo-CloneSuccess", basename(path)),
  confirmLabel: ga("OpenNowButtonLabel"),
  cancelLabel: ga("OKButtonLabel"),
});
```

Two-button modal. "Open Now" calls `openAfterClone(path,
afterCloneOpenRepoTabStrategy)` — default strategy is `OPEN_IN_NEW_TAB`
(`bundle:188492`).

## On failure

The `catch` block (`bundle:188701-188742`) shows an error toast:

```js
showToast({
  toastId: existingId,                          // updates the loading toast in place
  variant: toastVariants.ERROR,
  title: ga("CloneRepo-CloneFailed"),
  content: errorMessage + (err.message ? "\n" + err.message : ""),
  telemetry: { message: "CloneRepo-CloneFailed", additionalErrorContext: { hostingServiceType } },
});
```

For credential rejections (`maybeOrgOwner`), a richer error toast is
shown with a "Reconnect to <Provider>" button that opens an external
URL — this is GK proprietary (depends on integrations).

## yryvu implementation hints (#100 scope)

### Progress reporting via Tauri events

gix's `prepare_clone` accepts a `progress::Discard` or any
`gix_features::progress::Progress` impl. Approach for yryvu:

1. Backend command `clone_repository(url, dest, name, recurse,
   shallow_depth, session_id) -> Result<(), BackendError>` runs in
   `tauri::async_runtime::spawn_blocking`.
2. Inside the worker, build a custom `gix::progress::tree::Root` whose
   updates are forwarded over a Tauri event channel:
   `app.emit_to(window_label, "clone-progress",
   CloneProgressPayload { session_id, percent, phase, current,
   total })`.
3. Throttle emits server-side at 200 ms (between GK's 100 / 500). gix
   updates can fire several thousand times per second on fast disks —
   without throttling the IPC bridge floods.
4. Frontend listens via `listen("clone-progress", ...)` keyed by
   `session_id`.

Phases to surface:

- `Counting objects`     (gix: `Counting`)
- `Receiving objects`    (gix: `Receive pack`)
- `Resolving deltas`     (gix: `Indexing`)
- `Checking out files`   (gix: `Checkout`)

GK averages `received + indexed`, but gix gives us per-phase progress.
Better UX: show **current phase** + **phase-local percent**, not a
unified 0..100 average. This is a yryvu deviation — clearer for the
user.

### Cancel UX

`gix::interrupt::Trigger` lets us interrupt long ops at safe points.
yryvu Cancel button:

1. UI: cancel button inside the cloning toast.
2. Backend: store an `Arc<AtomicBool>` keyed by `session_id` in a
   global registry (mirror `oauth/state.rs` pattern from
   `crates/yryvu-bridge/src/integrations/oauth/state.rs`).
3. Worker checks the flag at gix's `interrupt::IS_INTERRUPTED` callback.
4. On cancel, gix unwinds the partial clone. Worker rms the partial
   destination directory before returning `BackendError::CloneCancelled`.

This is a yryvu UX win: GK has no clone cancel; yryvu ships it.

### Toast semantics

Reuse `notify.loading()` from `apps/yryvu-app/src/components/Notifications`:

```ts
const toastId = notify.loading(`Cloning to ${dest}`, {
  content: <CloneProgressBar sessionId={id} />,
  dismissable: false,
});
// on success: notify.success(`Cloned ${name}`, { ... }); dismissToast(toastId);
// on cancel:  notify.info("Clone cancelled");          dismissToast(toastId);
// on error:   notify.error(`Failed to clone ${name}`, { content: err });
//             dismissToast(toastId);
```

### Open-after-clone UX

Mirror GK's "Open Now" prompt as a yryvu `<Dialog>`:

- Title: "Repository cloned"
- Body: "<repo name> cloned to <dest>. Open it now?"
- Buttons: "Open" (primary) / "OK" (secondary, just dismisses)

`Open` → `openRepoInAnotherTab(dest)` (yryvu's `tabs/ops.ts`).

## Cross-validation

```
$ grep -n "CLONE_REPO_PROGRESS_UPDATED" /tmp/gk-bundle-pretty.js
188467: yield(0, Rn.call)(Dr.default, zn.cloneRepoIpcMessageChannels.CLONE_REPO_PROGRESS_UPDATED, Ve, at)
188472: yield(0, Rn.call)(Dr.default, zn.cloneRepoIpcMessageChannels.CLONE_REPO_PROGRESS_UPDATED, Ve, dt)
$ grep -n "Notification-CloningToPath" /tmp/gk-bundle-pretty.js
188557: title: ga("Notification-CloningToPath", ma),
```

Citations confirmed. The 100ms throttle (binary mode) was sourced from
`bundle:188559`; 500ms throttle (nodegit) from `bundle:188488`.

## Inversion check

The original prompt described "percent + current object reporting".
Verified: percent IS reported (`bundle:188471` formula above), and
current object NAME is **not** part of the GK pipeline — only object
counts. No string-style "Receiving foo.bin" labels surface in the toast.
yryvu's per-phase progress is more informative than GK's unified bar.
This is **yryvu deviation, not a bug fix**.
