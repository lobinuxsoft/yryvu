<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Yryvu Progress & Hand-off

Living hand-off note so a session on any machine (Linux, Windows, macOS) can
continue without re-deriving context. Workflow rules live in
[CONTRIBUTING.md](../CONTRIBUTING.md); the wave plan lives in
[ROADMAP.md](ROADMAP.md); this file is the *current state* + the durable,
non-obvious conventions.

## Current status

- **Released:** **v0.5.2** (2026-07-20, tag `yryvu-v0.5.2`). `main` and
  `development` are in sync at that version; unreleased Wave 9 perf work sits
  on `development` since.
- **Wave 9 — Perf + cleanup, in progress (6/11).** Closed: **#217** (RepoManagement
  DOD — SoA `KnownReposBatch` wire + virtualization + pre-indexed search),
  **#178** (metadata-only combined-diff summary — the inspector stopped
  serializing hunks), **#181** (graph walk perf — `BreadthFirst` for the full
  walk + rayon parallel decode; cheat-engine 985ms→417ms), **#37** (commit-list
  column resize — the fluid graph ceiling + bundle-accurate constraints).
  #181 was **re-diagnosed by measurement**: the original "stream the
  sort/layout" premise was wrong — the walk/decode is ~87% of the cost, the
  sort/layout ~10%. #37 turned out to be three parity defects in infrastructure
  that already existed, not a feature, and **#196** ("don't ask again" on the
  force-push confirmation — the one git-destructive prompt GitKraken lets you
  skip) and **#132** (remote management — rename plus split push URLs).
  **Next: #151 (commit-panel structural parity).**
- **Shipped in v0.5.2 — data-safety hardening, umbrella #448 CLOSED.** A user
  report ("a merge only keeps my side") turned out to be two distinct bugs;
  auditing the core git ops surfaced a cluster of **21 silent data-loss
  defects — none had a test, all passed the suite green.** All 21 are fixed
  (each with a regression test) and the umbrella is closed. See
  [Data-safety hardening](#data-safety-hardening-umbrella-448) below.
- **Also shipped — Wave 8 (Theme power v2), umbrella #297 CLOSED** (PRs #440–#445):
  token expansion (#298), multi-file `[layers]` (#299), `mask-image` icon system
  with `icons/`-folder override (#300), themeable graph node/edge vars (#301),
  9 themes' `personality.css` rewritten vs the real DOM (#303), `docs/themes/` (#302).
- **Backlog hygiene owed:** 7 open issues sit in no wave (#231 Add Worktree,
  #437, #38, #99, #101, #108, #233) and #27 (theme system) is likely already
  satisfied by Wave 8 — triage them into a wave or close them.
- **Un-smoked debt:** the #448 fixes shipped with backend regression tests + the
  undo-UX ones with vitest, but no live smoke of the touched flows (undo/redo,
  rejected push, branch rename, rebase `edit`). #75 (Apply Patch flow) + Wave 6's
  submodule/LFS panes are also un-smoked.

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

### Data-safety hardening (umbrella #448 — CLOSED, shipped v0.5.2)

A user report ("a merge only keeps my side") was **two** bugs (a fast-forward
checkout-order bug #447 + a lost merge-parent #454). Auditing the core git ops
with that lens surfaced 21 silent data-loss defects — all now fixed. The two
shapes **every** defect took — look for both when touching any git op:

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

- **Ref-then-checkout is a silent no-op iff the checkout is SAFE.** This governs
  every ref+checkout call site in the crate, so learn it once. Moving the ref
  first makes the checkout baseline equal the target; the diff is **not** empty
  (`checkout.c` passes `GIT_DIFF_INCLUDE_UNMODIFIED`), but every delta comes out
  `GIT_DELTA_UNMODIFIED`, whose arm is `CHECKOUT_ACTION_IF(FORCE, UPDATE_BLOB,
  NONE)`. Without FORCE nothing is written and the working tree silently keeps
  the old content while HEAD advances (#447). **With FORCE the same ordering is
  correct** — it degenerates into a `reset --hard`: `UPDATE_BLOB` on that arm,
  tracked-but-not-in-target removed, and missing files restored via the
  `RECREATE_MISSING` that FORCE implies. So `rebase/interactive/refs.rs`
  (`detach_to`, `move_branch_to`) moving the ref first is *not* this bug, and
  swapping their `.force()` for `.safe()` would recreate #447 instantly.
  Conversely the `.safe()` at `repo/merge.rs` is load-bearing in the other
  direction: a fast-forward must refuse to clobber uncommitted local changes
  (pinned by `fast_forward_preserves_unrelated_local_changes`). **Read the
  strategy before judging the ordering** (#462).
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
- **`git_remote_rename` (git2 `Repository::remote_rename`) likewise does what
  `git remote rename` does:** renames the config section, rewrites the default
  fetch refspec, and moves `refs/remotes/<old>/*` — one call, no re-fetch. It
  returns the refspecs it could *not* rewrite (hand-customised ones); those
  still name the old remote, so surface them (#132).
- **Check the API before declaring it missing.** Both renames above were
  hand-rolled or refused on the belief that libgit2 lacked them. #132's edit
  dialog kept its name field immutable for months behind a comment asserting
  "libgit2 lacks a single-call rename" — repeated in `DialogState`, so it read
  as settled fact. A wrong comment there cost no bug, just a feature nobody
  wrote. Read the binding's source; it is vendored under `~/.cargo/registry`.
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
- **An unmeasured value is not a small value.** Any effect publishing a metric
  derived from async data must distinguish "no data yet" from "little data".
  The graph column collapsed on every reload because an empty `rows()` yields
  a one-lane content width, which was published as the column's ceiling
  (#37). Guard on emptiness, not on the derived number.
- **A "don't ask again" checkbox is a claim that the operation is
  recoverable.** `ConfirmDialog`'s `suppressible` is opt-in per call site for
  that reason, and only force push *with lease* carries it — the lease makes a
  skipped prompt harmless, since a moved remote rejects the push. Never add it
  to anything that discards or resets. Force pull in particular is
  `reset(Hard)` + a forced checkout: it destroys uncommitted work, which is in
  no reflog, no ODB and no stash (#196).
- **Never persist a clamp.** When a constraint trims a user's setting, keep
  the trim and the intent apart — clamp on read, leave the stored value
  alone (GitKraken's `min(contentWidth, persistedWidth)`). Writing the
  trimmed value back is indistinguishable from the user choosing it, so the
  setting is destroyed the first time the constraint is tight.
- Error variants surface to the frontend as `BackendError` Display strings
  (the command does `.map_err(|e| e.to_string())`); the UI prefix-matches
  them, so keep Display prefixes stable.
- **A TOFU prompt is a claim the host is genuinely new.** SSH host-key
  verification (`repo/remote/known_hosts.rs`) must re-check `known_hosts`
  itself — git2-rs discards libgit2's `valid` bit, so a `certificate_check`
  can't learn whether the internal check passed. Only a hostname that matches
  *no* entry may prompt; a hostname that matches with a different key is a
  possible MITM and is rejected, never prompted. Never register a
  `certificate_check` that returns `Ok(CertificateOk)` unconditionally — that
  is the blind-accept hole. The decision logic is ported from Cargo's
  `known_hosts.rs`; don't "simplify" its branches (#508).

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

- **2026-07-24:** **SSH trust-on-first-use (#508, follow-up to #511).** Registered
  a git2 `certificate_check` that re-checks `known_hosts` ourselves — git2-rs
  discards libgit2's `valid` bit, so a callback can't tell a new host from a
  changed key. The decision core (hashed `|1|` entries, `@revoked`,
  `@cert-authority`, glob/negated patterns, new-vs-changed) is ported verbatim
  from Cargo's `known_hosts.rs`, tests included. A genuinely unknown host emits
  `ssh-tofu-prompt` and blocks the fetch worker on a channel (`repo/remote/tofu.rs`,
  registry + `OnceLock<AppHandle>` — same shape as the OAuth wait); the modal
  shows the SHA256 fingerprint, and on trust the exact approved key is appended
  to `~/.ssh/known_hosts`. A changed/revoked/unverifiable key is rejected hard
  and never prompts; no answer (timeout, no UI) refuses. **Durable rule below.**
- **2026-07-22:** **SSH remotes — foundation (#508, PR #511, open).** yryvu was
  built with `git2` minus the `ssh` feature, so every `git@host` remote failed
  with "unsupported URL protocol". Enabled `ssh` + `ssh_key_from_memory`, added a
  `~/.ssh/config` reader (globs/HostName/User/IdentityFile/Port, parses *past*
  `ProxyCommand` — never runs a program from a config file), and resolve keys
  OpenSSH-style: agent → IdentityFile → default names. Secure by default: with no
  `certificate_check` registered, libgit2 rejects an unknown/changed host key.
  **TOFU prompt is the follow-up** — git2-rs drops libgit2's `valid` bit
  (`remote_callbacks.rs:413`), so telling "new host" from "changed key" needs a
  vetted known_hosts parser (adopt, don't hand-roll — Cargo's own
  `known_hosts.rs` is the reference; `ssh-key` crate for primitives). ⚠️ enabling
  `ssh` links libssh2+openssl — the AppImage needs a clean-box smoke, CI won't
  prove it.
- **2026-07-22:** **#509 closed — fetch-all keeps going after a bad remote.** PR
  #510. It propagated with `?` inside the loop, so one unreachable remote aborted
  the run and (since `remotes()` is sorted) the alphabet decided whether your
  work got fetched. Now collects a `FetchReport`; the UI picks severity — partial
  is `info` with the count in the title (never "all"), only all-failed is an
  error. Title can't contradict body, which was the actual complaint.
- **2026-07-22:** **#437 closed — aggregate status badges on collapsed dirs.** PR
  #507. Per-status *file* counts (not lines — the only diffstat GK renders in a
  file list; the per-file pills were refuted out of #151). Folded bottom-up in
  the existing tree build; expanded folders hide their own badges, still-collapsed
  children keep theirs, no coordination. Letters not GK's icons (yryvu rows
  already speak in letters), and not filter-aware on purpose.
- **2026-07-22:** **#151 closed — commit-panel parity (7/11).** PR #506. Five
  items: header (discard-all icon + `{N} file changes on <pill>`), persisted sort
  ASC/DESC, inline per-section expand/collapse, draggable commit-region splitter
  (GK's 275/+25/panelHeight−249 bounds, clamp-on-read only), GK-verbatim button
  labels. Audit refuted four issue asks that GK doesn't ship (per-file diffstat
  pills, Pull/Push tab strip, eye icon, dual expand-all). **Also fixed a
  preexisting envelope-clobber bug**: four modules each cached the whole
  preferences envelope and wrote it back, so any write reverted another's fields
  — unified onto one owner (`state/preferences.ts`) with a serialised write chain.
- **2026-07-21:** **#132 closed — remote rename + split push URLs (6/11).** PR #504.
  The name field was immutable because a comment — repeated in
  `DialogState` — claimed libgit2 had no single-call rename. It does:
  `remote_rename` renames the config section, rewrites the default fetch
  refspec and moves the tracking refs in one call, which is exactly the
  re-fetch the comment was avoiding. A wrong comment cost a feature nobody
  wrote, for months. `remote.<name>.pushurl` is now editable on its own;
  emptying the field **clears** it rather than pinning it to the fetch URL
  the way GitKraken does. Dropped from the issue after auditing the bundle,
  all verified absent there: refspec editor, `mirror` toggle, per-remote
  prune, removal confirmation, and a remotes list showing URLs (we added a
  tooltip instead — GitKraken shows a remote's URL nowhere).
- **2026-07-21:** **#196 closed — force-push "don't ask again" (5/11).** PR #502.
  The issue asked for a generic `dontAskAgain` map across five destructive
  dialogs; the bundle has no such system — three ad-hoc flags in two stores,
  and exactly one covering a git-destructive confirmation: force push **with
  lease**. The lease is what makes skipping it safe (a moved remote rejects
  the push instead of overwriting a coworker). Everything that can lose work
  confirms unconditionally there, and most of those prompts are built on a
  type that structurally cannot hold a checkbox. Our force pull stays
  unsuppressible for the sharper version of the same reason — it is
  `reset(Hard)` + a forced checkout, so it discards uncommitted work that no
  reflog can return. `suppressible` is opt-in per call site on
  `ConfirmDialog`: the checkbox is a claim that the operation is recoverable.
  Issue body rewritten with the audit.
- **2026-07-21:** **#37 closed — commit-list column resize (4/11).** PR #500.
  A fresh bundle audit showed the handles, drag cascade and persistence were
  already in place (#141, #324); what remained were three parity defects. The
  graph zone's ceiling was pinned at a constant 800 — GitKraken assigns it at
  runtime from the lane content width, so wide repos couldn't be widened
  enough to show their own lanes. Constraints realigned with
  `graphZoneMetaData`, except `COMMIT_SHA_ZONE_MAX_WIDTH = 100`, which sits
  below GitKraken's own 130 presets and is not worth reproducing. Sibling
  drag handles were lit during a drag; GitKraken suppresses them.
  `changesZone` was **not** ported — the bundle has full metadata and a
  renderer for it behind a hardcoded `getShowCommitChangesInGraph = () =>
  false`. **Widths stay global, diverging from GitKraken's per-repo scope**
  (user decision: widths suit a screen, not a repository). **The smoke test
  earned its keep:** reloading collapsed the column to its minimum — the
  ceiling was published from a not-yet-loaded (empty) graph *and* the clamp
  was persisted as if chosen. See the two new conventions above.
- **2026-07-21:** **Wave 9 perf started (3/11).** #217 (PR #496 — RepoManagement
  SoA wire + virtualization + pre-indexed search), #178 (PR #497 — metadata-only
  combined-diff summary), #181 (PR #498 — graph walk: `BreadthFirst` for the
  full walk drops the discarded time-sort, rayon parallel decode; cheat-engine
  985→417ms). #181's original streaming premise was refuted by measurement
  (walk/decode ~87%, sort/layout ~10%) and the issue body rewritten. Next: #37.
- **2026-07-20:** **Released v0.5.2** — promote `development → main`, then merged
  release-please's `chore(main): release 0.5.2`. Tagged `yryvu-v0.5.2`;
  `build-release` produced the Linux AppImage + `.deb` and Windows `.msi`.
  Ships Wave 8 (themes) + the whole #448 cluster.
- **2026-07-20:** **#448 tail closed — umbrella done (21/21).** PR #491 (undo UX:
  #473 modal keybind guard, #474 button enablement tied to invertibility +
  two-endpoint reset label, #475 `discarded_dirty` flag with honest toast /
  tooltip / dialog), PR #492 (#462 — the SAFE-vs-FORCE checkout rule, in the
  comment and in this file's verified-behaviours list).
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
