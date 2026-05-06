# 12 — chajá implementation hints for #100

This is the bridge from research to plan. It does NOT prescribe a PR
structure — that decision is for the auditor when splitting #100 into
sub-PRs. Here we collect concrete recipes per layer.

## Backend recipes

### `clone_repository` Tauri command

Crate: `chaja-bridge`. Module: `repo/clone.rs` (new). Pattern: mirror
the existing `BACKEND: git2 —` markers when falling back to git2 for
ops gix can't do yet.

```rust
#[tauri::command]
pub async fn clone_repository(
    app: AppHandle,
    url: String,
    dest: String,
    name: String,
    options: CloneOptions,        // recurse_submodules, depth (Option<u32>)
    session_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        clone_impl(&app, &url, &dest, &name, options, &session_id)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

fn clone_impl(
    app: &AppHandle,
    url: &str,
    dest: &str,
    name: &str,
    opts: CloneOptions,
    session_id: &str,
) -> Result<(), BackendError> {
    let target = std::path::PathBuf::from(dest).join(name);
    if target.exists() && std::fs::read_dir(&target)?.next().is_some() {
        return Err(BackendError::CloneDestinationExists {
            path: target.display().to_string(),
        });
    }

    let url_parsed = gix::url::parse(url.into())
        .map_err(|_| BackendError::CloneInvalidUrl { url: url.into() })?;

    let mut prepare = gix::prepare_clone(url_parsed, &target)?;
    if let Some(depth) = opts.depth {
        prepare = prepare.with_shallow(gix::remote::fetch::Shallow::DepthAtRemote(depth.try_into()?));
    }

    let progress = make_progress_emitter(app, session_id);
    let interrupt = register_clone_session(session_id);

    let (mut checkout, _) = prepare
        .fetch_then_checkout(progress.clone(), &interrupt)?;
    let (_repo, _) = checkout.main_worktree(progress, &interrupt)?;

    if opts.recurse_submodules {
        // gix submodule recurse — or fallback git2 if missing
    }

    Ok(())
}
```

Dependencies:

- `register_clone_session(session_id)` mirrors
  `crates/chaja-bridge/src/integrations/oauth/state.rs` —
  `LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>>`, returns an
  `interrupt::IsInterruptedFn` closure.
- `make_progress_emitter` builds a `gix_features::progress::Progress`
  impl that throttles emits at 200ms and forwards via Tauri events.

### `init_repository` Tauri command

Module: `repo/init.rs` (new).

```rust
#[tauri::command]
pub async fn init_repository(
    app: AppHandle,
    base_path: String,
    folder_name: String,
    default_branch: Option<String>,    // None = use git's init.defaultBranch
    gitignore_template: Option<String>,// None = skip
    license_key: Option<String>,       // None = skip
    initialize_first_commit: bool,     // chajá addition; default true
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        init_impl(&app, &base_path, &folder_name, default_branch.as_deref(),
                  gitignore_template.as_deref(), license_key.as_deref(),
                  initialize_first_commit)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

fn init_impl(...) -> Result<String, BackendError> {
    // 1. Build target path; reject if non-empty git repo already there.
    // 2. Resolve default branch: override > init.defaultBranch from user's
    //    git config > "main" fallback. Validate per gix-validate.
    // 3. gix::init or gix::init_bare(target) with the chosen branch.
    // 4. If initialize_first_commit:
    //    a. Resolve gitignore template path from app resources.
    //    b. Resolve license template + run tag substitution.
    //    c. Write README.md ("# <folder_name>\n").
    //    d. fs::copy gitignore template -> <target>/.gitignore (if Some).
    //    e. Write LICENSE.md (if Some).
    //    f. Stage all + commit "Initial commit" with author from user
    //       config.
    // 5. Return target path as String for the frontend.
}
```

Backed by gix for init + gix-config for default branch + git2 for
the initial commit (gix's commit-write API is limited in 0.68 —
`BACKEND: git2 — initial commit signature/author`).

### `validate_git_repo` (FOLLOW-UP, not v1)

For doc 02's gap-fix recommendation. Out of #100 scope.

## Frontend recipes

### Dialog state model

Mirror the existing `DialogState` discriminated union in branchOps.
Add two new variants:

```ts
| { kind: "clone"; sessionId?: string }
| { kind: "init" }
```

Fields don't need to live in DialogState — clone/init dialogs have
several fields, store them in dialog-local Solid stores under
`apps/chaja-app/src/onboarding/{cloneOps,initOps}.ts`.

### CloneDialog component

Path: `apps/chaja-app/src/onboarding/CloneDialog.tsx`.

Reuse the existing `<Dialog>` shell from `LeftSidebar/dialogs/`. Field
set:

```
URL                         ─ <input type="text" autoFocus required>
Destination path            ─ <input> + <button onClick={browse}>...</button>
Repository name             ─ <input> (prefilled from URL last segment)
Recurse submodules          ─ <input type="checkbox" checked default>
[Advanced (collapsible)]
  Clone depth (shallow)     ─ <input type="number" min={1}> empty = full
```

Submit handler:

```ts
const sessionId = crypto.randomUUID();
const dialogError = createSignal<string | null>(null);
ipc.cloneRepository({ url, dest, name, options, sessionId })
   .then(() => {
     // success
     pushRecentRepo(`${dest}/${name}`);
     setRepoPath(`${dest}/${name}`);
     void openRepoInAnotherTab(`${dest}/${name}`);
     refreshKnownRepos?.();
     closeDialog();
     notify.success(`Cloned ${name}`);
   })
   .catch((err) => {
     // map err string -> typed if possible; fall back to toast
     setDialogError(humanizeCloneError(err));
   });
```

Listen for clone progress via `listen("clone-progress", ...)`, update
a local `CloneProgressBar` component inside the dialog body when the
session is in flight.

Cancel button: invokes `ipc.cloneCancel(sessionId)`. The backend flips
the AtomicBool; the in-flight `prepare_clone` exits at the next safe
point. Frontend listens for `clone-cancelled` event to close the
dialog.

### InitDialog component

Path: `apps/chaja-app/src/onboarding/InitDialog.tsx`.

Field set per doc 06. Pre-load `gitignoreOptions` and `licenseOptions`
once on first dialog open via `ipc.listGitignoreTemplates()` /
`ipc.listLicenseTemplates()`. Cache in a module-level signal — these
don't change at runtime.

Submit handler:

```ts
ipc.initRepository({
  basePath, folderName, defaultBranch, gitignoreTemplate, licenseKey,
  initializeFirstCommit,
})
  .then((targetPath) => {
    pushRecentRepo(targetPath);
    setRepoPath(targetPath);
    void openRepoInAnotherTab(targetPath);
    refreshKnownRepos?.();
    closeDialog();
    notify.success(`Repository created at ${targetPath}`);
  })
  .catch((err) => setDialogError(humanizeInitError(err)));
```

### Wiring into ColdStart and RepoManagement

ColdStart: replace `disabled` props with `onClick` openers. Add a
single `<CloneDialog>` and `<InitDialog>` portal at AppShell level so
both surfaces share the same dialog instance.

RepoManagement: same — remove `disabled`, add openers that target the
shared dialog instances.

### Dialog DOM and styling

Mirror `LeftSidebar/dialogs/AddRemoteDialog.tsx` (40 LOC reference
shape). Reuse:

- `dialog__field`, `dialog__btn`, `dialog__btn--primary`, `dialog__error`
  CSS classes (defined in the existing dialog stylesheet).
- `<Show when={ops.dialogError()}>` pattern for inline errors.

### File layout (suggested)

```
apps/chaja-app/src/onboarding/
├── index.ts                 # re-exports + AppShell portal hook
├── CloneDialog.tsx          # (~150 LOC) UI + ops wiring
├── InitDialog.tsx           # (~200 LOC) UI + ops wiring
├── cloneOps.ts              # state, submit handler, error humanizer
├── initOps.ts               # state, submit handler, error humanizer
├── progress.tsx             # CloneProgressBar (shared)
└── templates.ts             # cached resource lists (gitignore, license)
```

Cap per file 400 LOC (user rule). Split if any blows past.

## Resource bundling

Add to `apps/chaja-app/src-tauri/tauri.conf.json`:

```json
"bundle": {
  "resources": [
    "templates/gitignore/*.gitignore",
    "templates/licenses/*.txt",
    "templates/licenses/index.json"
  ]
}
```

Source the gitignore set from `github/gitignore` (CC0). Curate ~20.

License set per doc 08 (17 entries) sourced from the canonical license
texts.

## Suggested PR split for #100 (auditor decides — this is a recommendation only)

The auditor for #100 should consider promoting it to umbrella +
splitting into roughly:

| Sub-PR | Scope | Difficulty |
|---|---|---|
| 1 | Backend: `init_repository` + `list_gitignore_templates` + `list_license_templates` + bundled resources + typed errors | medium |
| 2 | Backend: `clone_repository` + `clone_cancel` + progress emitter + interrupt registry | medium |
| 3 | Frontend: `InitDialog` + ColdStart/RepoManagement wiring | medium |
| 4 | Frontend: `CloneDialog` + progress bar + cancel button | medium |
| 5 | Frontend gap fix (optional): `validate_git_repo` for Open + post-pick toast on missing `.git` | easy |

Each sub-PR is a single commit per checkbox per the
"commit-per-subtask" feedback. Sub-PRs 1 and 2 can ship in either
order; 3 depends on 1; 4 depends on 2; 5 is independent.

## Stylistic alignment

- All commits English Conventional, NO AI signatures.
- PRs base `development`, merge with `--merge`.
- Each sub-PR closes its own issue (umbrella stays open until last
  sub-PR).
- 400 LOC cap on every changed source file.
- All Rust new code: standard chajá patterns (typed errors, atomic
  write where applicable, `BACKEND: git2 —` markers when falling back).

## Open questions for the user (auditor)

These are decisions the auditor / user should make BEFORE sub-PR 1
opens, not deferred:

1. **Bundle gitignore/license resource size.** Curated subset (~50KB)
   vs. full upstream (~5MB). Recommendation: curated.
2. **`initialize_first_commit` checkbox default.** ON (matches GK) or
   OFF (purest empty `git init`). Recommendation: ON.
3. **Open-after-clone prompt vs auto-open.** Skip or show.
   Recommendation: skip (auto-open in new tab, matches Open behaviour).
4. **In-app credential prompt for HTTPS clone.** Defer to follow-up or
   include in v1. Recommendation: defer.
