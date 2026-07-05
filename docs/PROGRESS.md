<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Yryvu Progress & Hand-off

Living hand-off note so a session on any machine (Linux, Windows, macOS) can
continue without re-deriving context. Workflow rules live in
[CONTRIBUTING.md](../CONTRIBUTING.md); the wave plan lives in
[ROADMAP.md](ROADMAP.md); this file is the *current state* + the durable,
non-obvious conventions.

## Current status

- **`development` HEAD:** `3a8e53b` (2026-07-04). `main` = v0.5.0.
- **Just shipped:**
  - Perf epic **#430** (live file watcher + large-repo responsiveness):
    granular Tauri watch events, capped graph walk with pagination, file-list
    virtualization, and a FUSE/NTFS poll-watcher fallback.
  - **Wave 6** closed: per-filetype diff renderer (#60) and **apply-patch /
    `git am` equivalent (#75)**.
- **Next (do not start until picked up):** **Wave 8 — Theme power v2**
  (umbrella #297; start with tokens #298 or the docs warm-up #302). See
  [ROADMAP.md](ROADMAP.md).
- **Un-smoked debt:** #75 (Apply Patch flow) and Wave 6's submodule pointer
  pane + LFS placeholder were merged green but not manually smoked. Worth a
  visual pass before relying on them.

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
