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
| **9 — Perf + cleanup** | lazy hunks (#178), stream layout (#181), RepoMgmt DOD (#217), cols resize (#37), don't-ask (#196), remote mgmt (#132), HEAD-first (#126), deeplinks (#110), commit-panel parity (#151), BYO OAuth (#263), GK audit (#33) | v0.5.x → v0.6.x | ⬜ after #448 tail |
| 10 — M4 Luxuries | timeline (#23), inline-blame (#24), terminal (#25), themes umbrella (#27) | v0.6.0 (closes M4) | ⬜ |
| 11 — Packaging | Flathub (#361) | v1.0.0 | ⬜ |

### Blocked (outside waves)

- **#21** Git LFS — blocked on `gix-lfs`.
- **#307** LFS preferences — blocked on the same.

## Data-safety hardening (umbrella #448)

Orthogonal to the feature waves: a bug-fix cluster born from a user report
("a merge only keeps my side"). Auditing the core git ops surfaced ~21 silent
data-loss defects — none had a test, all passed the suite green. **This is the
immediate priority before resuming Wave 9.**

- **Closed (all `priority:high`):** #447, #449–#456, #461, #469, #470, #472
  (fixes) + #483 (refactor). Each shipped with a regression test.
- **Open (9, `medium`/`low`)** — pick these next:
  - #457 delete a branch checked out in another worktree orphans it
  - #458 worktree remove ignores the user's explicit lock
  - #459 first signed commit in a new repo leaves HEAD detached
  - #460 a failing rebase step never persists state (dup commits, no abort)
  - #462 the #447 fix comment states the wrong mechanism (docs)
  - #471 a stash-push undo pops the wrong stash
  - #473 the dirty dialog doesn't block the keybind; the parked op can be swapped
  - #474 undo/redo buttons stay enabled for ops that can never apply
  - #475 tell the user that redo does not restore discarded work
- **How to pick one up:** read the issue (each has a verified repro + file:line
  mechanism), find the sibling function that has the guard this one lacks, add
  the guard, and **test the round trip**. See
  [PROGRESS.md](PROGRESS.md#data-safety-hardening-umbrella-448) for the two
  recurring defect shapes and the verified libgit2 behaviours.

## Release pace

`release-please` on `main` cuts releases. Rough target:

```
v0.2.0 (W1) → v0.3.0 (W2, closes M1) → v0.4.0 (W3, closes M2)
→ v0.5.0 (W7, closes M3) → v0.6.0 (W10, closes M4) → v1.0.0 (W11 packaging)
```

Only `feat:` (minor), `fix:` (patch), and `BREAKING CHANGE` (major) bump the
version. `docs:` / `chore:` / `refactor:` / `test:` / `ci:` / `style:` /
`perf:` / `build:` do **not** trigger a release.

## Update regime

Re-snapshot [PROGRESS.md](PROGRESS.md) every session; update this file when:

- a wave closes (move it to ✅, advance the "next" marker),
- a milestone completes,
- issues are re-assigned between milestones,
- the release pace target changes.

Do **not** track individual sub-issues here — those live in GitHub.
