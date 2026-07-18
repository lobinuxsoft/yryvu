<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Yryvu Progress & Hand-off

Living hand-off note so a session on any machine (Linux, Windows, macOS) can
continue without re-deriving context. Workflow rules live in
[CONTRIBUTING.md](../CONTRIBUTING.md); the wave plan lives in
[ROADMAP.md](ROADMAP.md); this file is the *current state* + the durable,
non-obvious conventions.

## Current status

- **`development` HEAD:** `8952126` (2026-07-17). `main` = v0.5.0.
- **Just shipped — data-safety hardening, umbrella #448.** A user report ("a
  merge only keeps my side") turned out to be two distinct bugs; auditing the
  core git ops surfaced a cluster of ~21 silent data-loss defects — none had a
  test, all passed the suite green. See
  [Data-safety hardening](#data-safety-hardening-umbrella-448) below and the
  [ROADMAP](ROADMAP.md#data-safety-hardening-umbrella-448) for the live count.
  **All `priority:high` + the whole backend `medium` block closed; 4 UI/docs
  issues remain.**
- **Also shipped — Wave 8 (Theme power v2), umbrella #297 CLOSED** (PRs #440–#445):
  token expansion (#298), multi-file `[layers]` (#299), `mask-image` icon system
  with `icons/`-folder override (#300), themeable graph node/edge vars (#301),
  9 themes' `personality.css` rewritten vs the real DOM (#303), `docs/themes/` (#302).
- **Next:** finish the **#448 tail** — three undo-UX issues (#473, #474, #475,
  landable as one PR) + one docs fix (#462) — then **Wave 9 — Perf + cleanup**.
  See [ROADMAP.md](ROADMAP.md).
- **Un-smoked debt:** the #448 fixes shipped with backend regression tests but no
  live smoke of the touched flows (undo/redo, rejected push, branch rename,
  rebase `edit`). #75 (Apply Patch flow) + Wave 6's submodule/LFS panes are also
  un-smoked.

## GitKraken-fidelity rule (hard)

Yryvu clones GitKraken's **graphical** behavior 1:1, excluding only
GK-proprietary surfaces (Cloud Patches, Workspaces, Team visibility, GK-AI).
Provider integrations (GitHub/GitLab/Bitbucket/Azure/Jira) are standard
protocols and are in scope.

- Research lives in [`docs/research/gitkraken-*`](research/) — cite the doc in
  every issue that mirrors GK behavior.
- **Research is a secondary source. The GitKraken bundle is the source of
  truth** — validate claims against the actual bundle before *and* after
  implementing. The bundle is a separate GitKraken Desktop extract (not
  vendored here); point tooling at it via your own local path. GK only ships
  GitHub/GitLab/Bitbucket/Azure — Gitea/Forgejo/Jira UX is yryvu's own call.

## Durable technical conventions

These are easy to miss when copying handlers; they're the load-bearing ones.

### Backend layering

- Trait `GitBackend` (`crates/yryvu-bridge/src/backend/git_backend.rs`) →
  `GixBackend` impl (`repo/backend_impl.rs`) → per-domain `repo/*` modules →
  Tauri commands (`commands/*`) → registered in
  `apps/yryvu-app/src-tauri/src/lib.rs`.
- **`gix` is primary, `git2` is the fallback** for ops `gix` hasn't matured
  (checkout, tags, stash, reset, cherry-pick, revert, push, **patch apply**).
  `Diff::from_buffer` + `Repository::apply` have **no `gix` equivalent** — the
  patch path is git2-only. Debt is grep-able via `BACKEND: git2 —` markers.
- **Production never shells out to `git`.** Every `Command::new("git")` is
  `#[cfg(test)]`. A feature that would need the real CLI (e.g. true `git am`
  in-progress state / 3-way merge) is either built git2-native or deferred —
  see [the apply-patch note](#apply-patch-git2-native-atomic).
- **Command layer stamps identity; `repo/` stays pure.** Commit-creating
  commands resolve the active profile (`commands/profiles.rs`) and pass
  `(name, email)` down; the `repo/` functions never touch profiles or
  `AppHandle`. Sidecars/config paths are resolved by the bridge from
  `AppHandle`, never seen by the frontend.

### Data-safety hardening (umbrella #448)

A user report ("a merge only keeps my side") was **two** bugs (a fast-forward
checkout-order bug #447 + a lost merge-parent #454). Auditing the core git ops
with that lens surfaced ~21 silent data-loss defects. The two shapes **every**
defect took — look for both when touching any git op:

1. **A guard that exists in the sibling function and is missing right here.**
   `cherry_pick` pre-flights a dirty tree, `begin_rebase` didn't (#449).
   `delete_local_branch` refuses the checked-out branch, `rename_branch` didn't
   (#455). `record_op_best_effort` gates on the skip-guard, `clear_log_best_effort`
   didn't (#469).
2. **Doc-comments that promise a guarantee the code doesn't give.** "perfectly
   inverts", "never touches", "refuses" — treat every such phrase as a claim to
   verify, not a fact (#462, #451's Mixed-reset comment).

**Testing rule (bought with a regression):** for undo/redo, stage/unstage,
stash push/pop — **test the round trip, not each half.** #467 shipped 5 tests,
each proving one direction, and broke `commit → undo → redo` (hotfix #468).

**Verified libgit2 behaviours (vendored 1.8.1):**

- **The local transport reimplements receive-pack: it runs no server hooks and
  honours no `receive.deny*` config.** So a rejected *delete* can't be unit-tested
  against a local bare repo — only a non-fast-forward is refused locally (that's
  what surfaces server rejections in tests). `remote.push()` returns `Ok` even on
  a per-ref rejection; the rejection rides **only** the `push_update_reference`
  callback — register it or every rejected push reports success (#456).
- **`git_branch_move` (git2 `Branch::rename`) does what `git branch -m` does:**
  `git_reference_rename` follows HEAD across every worktree, and
  `git_config_rename_section` migrates the whole `[branch "old"]` section. Prefer
  it over a hand-rolled gix rename (#455).
- **`reset.c` forces `GIT_CHECKOUT_FORCE`** and checks out *before* moving the
  ref, so every `repo.reset()` is safe by construction and `reset --hard` never
  refuses on a dirty tree — destructive undos need their own dirty guard (#450).
- **Cherry-pick/revert undo:** reset to the parent of the **recorded** `new_sha`
  and verify `HEAD == new_sha` first; a blind `HEAD~1` destroys the wrong commit
  after any out-of-app commit (#461).
- **On an unborn branch `repo.head()` errors** (not detached), so `commit_signed`
  → `move_head_to` must resolve HEAD's symbolic target and *create* the branch;
  overwriting HEAD with a direct ref detaches it on the very first signed commit
  (#459). The unsigned path is fine — `repo.commit(Some("HEAD"), …)` resolves the
  symref itself.
- **A branch checked out in a *linked* worktree** isn't the current repo's HEAD,
  so a HEAD-only guard misses it; enumerate `main_repo().worktrees()` and refuse
  the delete force-or-not, as git does (#457).
- **`WorktreePruneOptions::locked(true)` is git's *second* `--force`** — it prunes
  through a lock. Guard the lock explicitly and drop the flag; delete the workdir
  **before** pruning the admin dir so a failed rmdir leaves a still-registered,
  re-prunable worktree rather than orphaned work (#458).
- **`stash@{index}` positions shift** as entries are pushed/popped, so a recorded
  stash must be re-resolved by sha (`stash_foreach`) before popping — never blind
  `stash@{0}` (#471).
- **`run_pending` mutates state (commits, cursor) then can error**, and `?` skips
  the sole `save_state`. Persist the partial state before propagating, or a
  re-Continue duplicates a committed step and a `begin` failure strands a
  stateless detached HEAD (#460).

**Undo-log invariants** (`crates/yryvu-bridge/src/undo_log/`): the sidecar
`.git/yryvu-undo.json` is read-modify-write with no lock; `undo_last_operation`
takes a process-wide mutex so concurrent Ctrl+Z can't double-apply a HEAD-relative
inverse (#472). Both `record_op_best_effort` **and** `clear_log_best_effort` gate
on the `SKIP_RECORD` thread-local. Recording after a full undo truncates to 0
(`cursor.map_or(0, |c| c + 1)`), not skipped when `cursor == None` (#470).

**Interactive rebase `edit`** (`repo/rebase/interactive/`): the step's commit is
created eagerly (it's already HEAD at the pause), so continue **amends** it with
the staged tree — `Commit::amend` preserving author + message. Fidelity to git:
only the index is committed; unstaged changes abort (never discarded); a clean
index is a no-op. The module is split `exec.rs` (entry points) / `steps.rs`
(plan walk) / `refs.rs` (ref moves) / `state_io.rs` (sidecar) / `plan.rs` (types).

### Frontend refresh pattern

Any op that mutates repo state bumps the matching nonce in `state/`:

- `refreshGraph()` — commits stream changed.
- `refreshBranches()` — local/remote refs, tags.
- `refreshWorkingTree()` — index or working tree (staging, commit, reset,
  checkout, merge, cherry-pick, revert, stash, **apply-patch**).

The `CommitGraph` subscribes only to `graphNonce`, so ops that move HEAD from
`branchOps` must also call `refreshGraph()`. **Missing a refresh is the most
common stale-UI bug** — mirror an existing sibling handler (e.g. `doRevert`,
`doCherryPickOnto`) exactly.

### apply-patch: git2-native, atomic

`repo::patches::apply_patch` (`git am` equivalent, #75): `git2` `apply` is
**atomic** — a malformed/non-applying patch leaves the repo untouched, so
there is no `apply-mailbox` in-progress state and nothing to abort. Resolve
everything fallible (parent, author, committer) and refuse a dirty index
**before** the first mutation. The signature trailer is stripped with `rfind`
(a deleted `- ` line collides with `\n-- \n`); patch files are CR-normalized
(`\r\n` → `\n`) to match `git am`'s default.

### Theme system (Wave 8)

- **Three injected layers.** `get_theme_css` returns `{ tokens, icons,
  personality }`; the frontend injects one `<style>` per layer
  (`yryvu-theme-{tokens,icons,personality}`), replacing `textContent` on switch.
  Only the **active** theme's CSS is ever in the DOM — so `personality.css`
  uses **bare selectors** (`.toolbar { … }`), no `:root[data-theme]` scoping.
- **Defaults cascade, don't duplicate.** New `--*` tokens live only in the
  chrome `:root` baseline (`apps/yryvu-app/src/styles/tokens.css`); custom
  props resolve lazily at the use site, so a theme overriding `--radius-md`
  moves `--btn-radius` for free. Themes override selectively; the 11
  `resources/themes/<id>/tokens.css` don't repeat unchanged tokens.
- **Icons = CSS masks, overridable by a folder.** `<Icon name>` →
  `.icon[data-icon] { mask-image: var(--icon-<name>) }`. A theme's
  `icons/<name>.svg` is base64-inlined by the loader into a scoped
  `--icon-<name>` override — a raw `url("icons/x.svg")` in injected CSS can't
  resolve to disk under CSP, so **the backend inlines it** (same reason fonts
  must be `data:` URIs). Names + recipes in [`docs/themes/`](themes/).
- **Graph visuals hydrate CSS→JS.** `--graph-node-radius` / `--graph-edge-width`
  feed the numeric render dims (they also drive lane-streak + SVG extent), so
  `RowRenderer/dims.ts` re-reads them via `getComputedStyle` on graph mount and
  on `themeAppliedVersion` (bumped **after** injection so the read isn't stale).
  Row height / lane width / arc geometry stay JS — themeable-ing them would
  reflow the virtualizer, so they're deliberately **not** exposed.
- **`create_from_template` clones the whole folder** (recursive, nested layer
  dirs + `icons/` included) then patches `theme.toml` via a `toml::Table`
  mutation — a `ThemeMetadata` round-trip silently drops the `[layers]` table.
- Built-in themes are embedded (`include_dir`), so editing one recompiles the
  bridge (no HMR); the recursive file-watcher hot-reloads **custom** themes
  (incl. added/edited `icons/*.svg`) live.

### Other conventions worth knowing

- **No monolithic files (>400 LOC).** Split into a folder with a `mod.rs`
  re-export (Rust) or an `index.tsx` barrel (TS) so importers don't change.
  Two documented exceptions: `repo/backend_impl.rs` and
  `backend/git_backend.rs` (a single trait impl/def can't be split).
- **Rust = Data-Oriented Design** (SoA over AoS, `u32` indices, POD across the
  GPU boundary where relevant). No `Box<dyn Trait>` / `Rc<RefCell<T>>` in hot
  paths.
- **Solid gotchas:** don't destructure `props` (breaks reactivity); dynamic
  classes go in `classList`, not `class`; `createResource` keeps its last
  value during refetch.
- Error variants surface to the frontend as `BackendError` Display strings
  (the command does `.map_err(|e| e.to_string())`); the UI prefix-matches
  them, so keep Display prefixes stable.

## Dev setup (cross-OS)

- **Run the app:** from `apps/yryvu-app/`, `bun run tauri dev`. (The Tauri
  script is not at the workspace root.)
- **Package manager:** Bun for the frontend; Cargo for the workspace.
- **Gates before pushing** (all must pass):
  - Rust: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`,
    `cargo test -p yryvu-bridge`.
  - Frontend (in `apps/yryvu-app/`): `bun run tsc --noEmit`, `bun run test`,
    `bun run build`.
- **CI** runs two checks on every PR: `rust` and `frontend`.
- **Vite white-screen after a file→folder refactor or heavy branch-switching:**
  stop `tauri dev`, delete `apps/yryvu-app/node_modules/.vite`, relaunch.
- Built-in themes are embedded (`include_dir`) in
  `crates/yryvu-bridge/resources/themes/<id>/` — they recompile the bridge,
  they do not hot-reload.

## Recent session log

Newest first. Keep entries short — one unit of work each.

- **2026-07-17 (bis):** **#448 tail — backend `medium` block closed.** Five PRs,
  each with a regression test and verified against source before touching (none
  were already fixed): #459/#485 (first *signed* commit on an unborn branch
  detached HEAD — `move_head_to` now births the branch), #457/#486 (delete of a
  branch checked out in a linked worktree, force or not, refused), #458/#487
  (worktree remove now honours the lock, deletes the workdir before pruning the
  admin dir, and treats an uninspectable path as dirty), #471/#488 (stash-push
  undo pops the *recorded* stash, not `stash@{0}`; records the stash flags for
  redo), #460/#489 (a rebase step failing mid-plan now persists the advanced
  state, so a re-Continue can't duplicate a committed step and `begin` can't
  strand a stateless detached HEAD). Only #462/#473/#474/#475 (docs + undo UX)
  remain in the umbrella.
- **2026-07-17:** **Data-safety hardening (umbrella #448) — all `priority:high`
  closed.** Eight PRs: #469/#470 (undo-log corruption), #472 (concurrent Ctrl+Z
  drops commits), #461 (cherry-pick undo blind-resets), #456 (rejected push
  reported as success), #455 (branch rename dangles HEAD + drops upstream), #451
  (rebase `edit` discarded edits), + #483 (split `exec.rs` under 400 LOC). Each
  fix carries a regression test — the audit's whole point was that none existed.
  Full-repo review afterward: gates green, the fixes don't interact, monolith
  scan clean (only `exec.rs` had production >400, now split). 9 `medium`/`low`
  #448 issues remain (#457–#460, #462, #471, #473–#475). See
  [Data-safety hardening](#data-safety-hardening-umbrella-448).
- **2026-07-11:** **Wave 8 (Theme power v2) shipped end-to-end — umbrella #297
  closed.** Six sub-PRs #440–#445: token expansion (#298), multi-file `[layers]`
  (#299), icon-mask system with `icons/`-folder override (#300), themeable graph
  node/edge vars (#301), 9 themes' `personality.css` rewritten vs the real DOM
  (#303), and `docs/themes/` + per-theme READMEs (#302). #300's approach was
  reshaped mid-flight (drop-an-svg over hand-encoded data URIs) and #301 was
  descoped to visual-only after audit; both recorded on their issues. Caught +
  fixed a latent `create_from_template` bug (layered-theme duplication dropped
  `[layers]` + `personality/`).
- **2026-07-04 (bis):** #75 apply-patch (`git am`) shipped (PR #435), Wave 6
  closed. A 4-lens adversarial review of the branch caught 7 real defects
  (trailer-strip `find`→`rfind`, dirty-index fold, non-atomic post-apply
  failures, `---`-in-message truncation, CRLF rejection, stale working-tree
  refresh, mutable precondition toast) — all fixed with regression tests. See
  [the apply-patch note](#apply-patch-git2-native-atomic).
- **2026-07-04:** Perf epic #430 closed — file-list virtualization (PR #434,
  GK-accurate bounded per-list viewports) after A/B/watcher landed earlier.
- **2026-07-02:** Perf epic #430 opened; live watcher (#431) + graph walk cap
  (#432) + FUSE/NTFS poll fallback (#433).
