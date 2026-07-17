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
| **9 — Data safety** | umbrella **#448** — 21 defects in core git ops, 6 fixed. **Absolute priority, blocks the next release.** | v0.5.x | 🔥 **in progress (6/21)** |
| 10 — Perf + cleanup | lazy hunks (#178), stream layout (#181), RepoMgmt DOD (#217), cols resize (#37), don't-ask (#196), remote mgmt (#132), HEAD-first (#126), deeplinks (#110), commit-panel parity (#151), BYO OAuth (#263), GK audit (#33) | v0.5.x → v0.6.x | ⬜ |
| 11 — M4 Luxuries | timeline (#23), inline-blame (#24), terminal (#25), themes umbrella (#27) | v0.6.0 (closes M4) | ⬜ |
| 12 — Packaging | Flathub (#361) | v1.0.0 | ⬜ |

### Wave 9 — Data safety (umbrella #448)

Started 2026-07-16 from a user report: *"al mergear sólo se queda con lo tuyo"*. That
turned out to be **two** distinct bugs sharing one symptom (#447 fast-forward, #454
merge parent). A five-lens audit of the core git operations found 14 more; a second,
undo/redo-focused round found 7 more.

Every defect was confirmed against the vendored libgit2 1.8.1 source rather than
recalled, and reproduced with an executable probe before filing. **None of them had a
test. All of them passed the suite green.**

**Fixed:** #447 (FF checkout order), #449 (rebase over dirty tree), #450 (undo guard,
+ hotfix #468), #452 (discard destroys staged), #453 (force-with-lease), #454 (merge
parent + MERGE_HEAD).

**Open, most severe first:** #469, #470, #472, #451, #455, #456, #471, #475, #457,
#458, #459, #460, #461, #473, #474, #462.

**Why it is its own wave:** these are silent data-loss bugs. They do not surface in
review, and a green suite says nothing about them — only a test that reproduces the
loss keeps them dead. `main` (v0.5.0) still ships all of them.

### Blocked (outside waves)

- **#21** Git LFS — blocked on `gix-lfs`.
- **#307** LFS preferences — blocked on the same.

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
