<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Yryvu Progress & Hand-off

Living hand-off note so a session on any machine (Linux, Windows, macOS) can
continue without re-deriving context. Workflow rules live in
[CONTRIBUTING.md](../CONTRIBUTING.md); the wave plan lives in
[ROADMAP.md](ROADMAP.md); this file is the *current state* + the durable,
non-obvious conventions.

## Current status

- **`development` HEAD:** `50b688c` (2026-07-16). `main` = v0.5.0, **231 commits behind**.
- **In progress — Wave 9 (Data safety), umbrella #448.** Absolute priority by user
  decision; blocks the next release. 6 of 21 fixed. See [ROADMAP.md](ROADMAP.md).
- **Next up:** **#469** and **#470** — both one-line fixes, both `priority:high`,
  both data-loss.
- **⚠️ `main` still ships every one of these bugs.** A user on a release binary can
  still have a pull silently revert their teammate's work (#447). Worth deciding on a
  release before continuing down the list.
- **Un-smoked debt:** #75 (Apply Patch flow), Wave 6's submodule pointer pane + LFS
  placeholder. The Wave 9 fixes are covered by regression tests; #467's dialog was
  smoked by the user.

## Data safety — durable lessons (Wave 9)

The audit found the same two shapes over and over. Both are invisible to review:

1. **A guard that exists in the sibling function and is missing here.**
   `cherry_pick_commits_onto` pre-flights a dirty tree; `begin_rebase` did not (#449).
   `delete_local_branch` refuses the checked-out branch; `rename_branch` does not
   (#455). `create_tag` signs before mutating; `annotate_tag` does not. The `Merge`
   and `Commit` undo arms reset by recorded SHA; `CherryPick`/`Revert` reset blind
   (#461).
2. **A doc-comment promising a guarantee the code does not provide.** Five so far,
   including the one written on the #447 fix itself (#462). Treat every "this refuses
   / never touches / perfectly inverts" comment as a claim to verify, not a fact.

### libgit2: the checkout baseline is HEAD's tree

**Order: `checkout_tree` FIRST, move the ref AFTER.** libgit2 defaults the checkout
baseline to HEAD's tree. Move the ref first and `baseline == target`; the diff yields
an `UNMODIFIED` delta per path (`GIT_DIFF_INCLUDE_UNMODIFIED`), and
`checkout.c:498-503` resolves that to `CHECKOUT_ACTION_IF(FORCE, UPDATE_BLOB, NONE)`.

So the real rule is: **ref-before-checkout is a silent no-op iff the strategy is
SAFE.** With FORCE the same ordering degenerates into a correct `reset --hard`. This
is why `merge.rs`'s `.safe()` is load-bearing (with `.force()` a fast-forward would
clobber local edits) and why `rebase/interactive/exec.rs` is correct despite the
inverted order.

### Other verified libgit2 behaviours

- `reset.c:150-159` forces `GIT_CHECKOUT_FORCE` and checks out **before** moving the
  ref, ignoring caller options. So every `repo.reset()` call site is safe by
  construction — and `reset --hard` **never** refuses over a dirty tree (#450).
- `checkout_head` is `checkout_tree(HEAD)`: it restores from **HEAD**, not the index,
  and rewrites the index too unless `DONT_UPDATE_INDEX` is set. `git checkout --
  <path>` restores from the **index** — use `checkout_index` (#452).
- `push.c:378-380`: `update.src` is what the **remote** has; `update.dst` is the
  **local** oid being pushed. A lease compares against `src` (#453).
- `git_remote_push` does **not** error on a per-ref rejection — only the
  `push_update_reference` callback surfaces it (#456).
- Git never infers a merge: the commit object must list the parent, so a commit
  written while `MERGE_HEAD` exists has to read it (#454).

### Testing rule

**Test the round trip, not each half.** #467 added five tests, each exercising one
direction, and shipped a regression that made `commit → undo → redo` unreachable
(fixed in #468). Undo/redo, stage/unstage, and stash push/pop all need both
directions in one test.

Fixture identity must go through git config, not `GIT_AUTHOR_*` env vars: those reach
only the git CLI, while libgit2 reads the config. CI runners have no global
`user.name`. Reproduce CI locally with
`HOME=$(mktemp -d) CARGO_HOME=~/.cargo RUSTUP_HOME=~/.rustup cargo test` — preserving
CARGO_HOME/RUSTUP_HOME, or rustup re-downloads the toolchain and the results are junk.

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
