<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Yryvu Roadmap

The source of truth for *what* is planned is the GitHub issues and the
[Project board](https://github.com/users/lobinuxsoft/projects/7). This file
records the **ordering** and **milestone mapping** — the plan that isn't
derivable from the issues alone — so any contributor (on any OS) can pick up
where the last session left off.

> Keep this file in sync when a wave closes or a milestone ships. It is the
> hand-off document between work sessions.

## Milestones

| Milestone | Theme | Status |
|---|---|---|
| **M1** MVP Core | daily-driver git client | ✅ shipped (v0.3.0) |
| **M2** Differentiators | drag-drop, stash UI, cherry-pick | ✅ shipped (v0.4.0) |
| **M3** Pro Features | gitflow, worktrees, profiles | ✅ shipped (v0.5.0, minus LFS) |
| **M4** Polish & Luxuries | timeline, inline-blame, terminal, themes | ⬜ ~20% |

Latest release: **v0.5.2** (2026-07-20) — ships the Wave 8 theme system and the
complete #448 data-safety cluster.

## Wave ordering (locked)

Waves are ordered by **progress visible to the end user**: shell first, then
daily flow, then differentiators, then luxuries. Each wave maps to a release.

| Wave | Scope | Release | Status |
|---|---|---|---|
| 1 — Shell completion | tabs, multi-repo, welcome | v0.2.0 | ✅ done |
| 2 — Core git daily | commit, checkout, history, blame | v0.3.0 (closes M1) | ✅ done |
| 3 — Differentiators | drag-drop, stash UI, cherry-pick | v0.4.0 (closes M2) | ✅ done |
| 4 — Stash visibility | graph nodes, context menu, inspector | v0.4.0 | ✅ done |
| 5 — Sidebar polish | remotes, submodules, SSH keys | v0.5.0 | ✅ done |
| 6 — Diff completeness | per-filetype renderer (#60), apply-patch / git am (#75) | v0.4.x | ✅ done |
| 7 — M3 Pro | gitflow (#19), worktrees (#20), profiles (#22) | v0.5.0 (closes M3) | ✅ done |
| 8 — Theme power v2 | tokens (#298), manifest (#299), icons (#300), graph vars (#301), rewrite themes (#303), docs (#302) — umbrella #297 | v0.5.x | ✅ done |
| **9 — Perf + cleanup** | ~~RepoMgmt DOD (#217)~~, ~~lazy hunks (#178)~~, ~~graph walk (#181)~~, ~~cols resize (#37)~~, ~~don't-ask (#196)~~, ~~remote mgmt (#132)~~, HEAD-first (#126), deeplinks (#110), commit-panel parity (#151), BYO OAuth (#263), GK audit (#33) | v0.5.x → v0.6.x | 🔄 in progress (6/11 — next #151) |
| 10 — M4 Luxuries | timeline (#23), inline-blame (#24), terminal (#25), themes umbrella (#27) | v0.6.0 (closes M4) | ⬜ |
| 11 — Packaging | Flathub (#361) | v1.0.0 | ⬜ |

### Blocked (outside waves)

- **#21** Git LFS — blocked on `gix-lfs`.
- **#307** LFS preferences — blocked on the same.

## Data-safety hardening (umbrella #448) — ✅ CLOSED

Orthogonal to the feature waves: a bug-fix cluster born from a user report
("a merge only keeps my side"). Auditing the core git ops surfaced **21 silent
data-loss defects — none had a test, all passed the suite green.** All 21 are
fixed, each with a regression test, and **shipped in v0.5.2** (2026-07-20).

- **Closed (21/21):** #447, #449–#462, #469–#475 (fixes) + #483 (refactor).
  The umbrella #448 itself is closed.
- **What it taught** (kept as durable conventions in
  [PROGRESS.md](PROGRESS.md#data-safety-hardening-umbrella-448)):
  1. A guard that exists in the sibling function and is missing right here —
     check the sibling before trusting the function.
  2. Doc-comments that promise a guarantee the code doesn't give (four of them).
  3. For undo/redo, stage/unstage, stash push/pop — **test the round trip**,
     not each half.
  4. Ref-then-checkout is a silent no-op *iff* the checkout is SAFE; with FORCE
     the same ordering is a correct `reset --hard` (#462). Governs every
     ref+checkout call site in the crate.
- **The recurring defect shapes and verified libgit2 1.8.1 behaviours** live in
  PROGRESS.md — read them before touching any core git op.

## Release pace

`release-please` on `main` cuts releases. Milestone-closing targets:

```
v0.2.0 (W1) → v0.3.0 (W2, closes M1) → v0.4.0 (W3, closes M2)
→ v0.5.0 (W7, closes M3) → v0.6.0 (closes M4) → v1.0.0 (W11 packaging)
```

Latest: **v0.5.2** — the theme system (W8) and #448 data-safety cluster. The
`0.5.x` patch line carries feature + fix work that doesn't close a milestone;
v0.6.0 is reserved for Wave 10 closing M4.

**Pre-1.0 versioning:** the config uses `bump-minor-pre-major` +
`bump-patch-for-minor-pre-major`, so **`feat:` bumps the patch, not the minor**,
until we hit 1.0. `feat:` / `fix:` / `perf:` and `BREAKING CHANGE` trigger a
release; `docs:` / `chore:` / `refactor:` / `test:` / `ci:` / `style:` / `build:`
do **not**.

### Release procedure (two merges)

1. Sync first: `git merge origin/main` into `development` — the previous
   release-please commit (version bumps + CHANGELOG) lives only on `main`, so
   `development` is otherwise BEHIND and the promote PR is rejected under strict
   branch protection.
2. Open a PR `development → main`; merge it. The push to `main` runs
   release-please, which opens a `chore(main): release X.Y.Z` PR.
3. Merge that PR. It tags `yryvu-vX.Y.Z` and runs `build-release` (Linux
   AppImage + `.deb`, Windows `.msi`) via `workflow_call` — no PAT needed, the
   build is not gated on the tag-push event.
   - The release-please PR's CI may land in `action_required` (manual approval);
     approve the run after confirming its diff is only bumps + CHANGELOG.

## Update regime

Re-snapshot [PROGRESS.md](PROGRESS.md) every session; update this file when:

- a wave closes (move it to ✅, advance the "next" marker),
- a milestone completes,
- issues are re-assigned between milestones,
- the release pace target changes.

Do **not** track individual sub-issues here — those live in GitHub.
