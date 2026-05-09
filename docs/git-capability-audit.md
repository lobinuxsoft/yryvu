# Yryvu — Git capability audit

> Companion to [`docs/ui-reference.md`](ui-reference.md). Read the preamble of
> that file first. This document operationalises the corrected product
> principle: **scope is all of Git; GitKraken is UX inspiration only**.

The existing UI issues (#2 #3 #5 #6 #9 #12 #14 #15 #18 #19 #22 #25) cover the
slice of Git that GitKraken exposes well. This audit catalogs the Git
capabilities GitKraken hides, under-exposes, or skips entirely — so that
Yryvu's planning does not default to "what GitKraken does" by inertia.

## Status of this document

This is a **partial pass** of issue #33. Only sections 1 and 3 of the issue
acceptance criteria are produced here.

- **§ 1 Capability matrix** — produced below with the 21 seed entries.
- **§ 2 Initial seed list** — the seed list lives inside the matrix; no
  separate section.
- **§ 3 Peer comparison** — produced below.
- **§ 4 Follow-up issues** — **deferred** to a later pass. The user will
  triage the matrix first and decide which gaps are accepted before any new
  issues are opened in the tracker. Do not spawn issues from this doc
  without explicit go-ahead.

## How to read the matrix

- **Capability** — the Git feature, with the canonical command or concept.
- **GitKraken exposure** — one of:
  - `first-class` — has a dedicated panel, dialog, or top-level menu entry.
  - `secondary` — reachable but buried (sub-menu, right-click chain, or
    requires opening a dialog first).
  - `hidden` — only via Command Palette / keyboard shortcut; no discoverable
    UI affordance.
  - `absent` — not exposed at all; user must drop to terminal.
- **Yryvu decision** — proposed disposition. Values:
  - `yes` — in scope; ship before v1.0.
  - `yes (deferred)` — in scope but after M4 / v1.0.
  - `undecided` — needs user triage.
  - `no` — out of scope for Yryvu.
- **Proposed UX surface** — panel / dialog / menu / palette / inspector-tab.
  Pointer only; the final surface is decided when the follow-up issue is
  opened.
- **Related issue** — link to an existing issue if the capability is already
  partially covered, or `→ new issue` if a follow-up is expected.

All GitKraken-exposure calls in the matrix reflect the state as observed in
the screenshots collected in `docs/assets/gk/` plus direct usage of GitKraken
v10.x on Linux. Where the call is uncertain, the row is marked with
`(verify)` and should be re-checked before accepting the decision.

---

## 1. Capability matrix

| # | Capability | GitKraken exposure | Yryvu decision | Proposed UX surface | Related issue |
|---|---|---|---|---|---|
| 1 | `git bisect` (start, good, bad, skip, run, visualize, reset) | absent | **yes** | Dedicated panel in right inspector + ribbon on graph marking current range; palette entries `Bisect: …` | → new issue |
| 2 | `git reflog` (HEAD + per-ref browser, restore-to-here action) | absent | **yes** | Left sidebar entry under "History" group; inspector tab shows reflog for selected ref | → new issue |
| 3 | `git worktree` (list, add, remove, lock, prune) | secondary | **yes** | First-class left-sidebar section "Worktrees"; right-click on branch → `Create worktree from` | [#20](https://github.com/lobinuxsoft/yryvu/issues/20) |
| 4 | `git notes` (per-commit, multiple namespaces) | absent | **yes (deferred)** | Commit inspector tab "Notes"; namespace picker in commit context menu | → new issue |
| 5 | Patch series — `git format-patch` / `git am` | absent | **yes** | Commit/range context menu `Export as patch series…`; drop-zone for `.patch`/`.mbox` to apply | → new issue |
| 6 | `git sparse-checkout` (cone mode toggle, pattern editor) | absent | **undecided** | Repo preferences tab "Sparse checkout" with pattern editor and preview | → new issue |
| 7 | `git rerere` (status, clear, training) | absent | **yes (deferred)** | Preferences toggle + conflict-resolver footer showing "rerere applied"; palette `Rerere: clear` | → new issue |
| 8 | Repo health — `git fsck` / `git gc` / `git maintenance` | absent | **yes** | Repo preferences tab "Maintenance" with run/schedule and a report panel | → new issue |
| 9 | Hooks management (list, enable/disable, edit per-repo and per-user) | absent | **yes** | Repo preferences tab "Hooks" with template picker, enable/disable, open-in-editor | → new issue |
| 10 | Git LFS (install, track patterns, file status, prune) | first-class | **yes** | Already covered — include LFS status in status bar and in file inspector | [#21](https://github.com/lobinuxsoft/yryvu/issues/21) |
| 11 | Multi-remote management (add/remove/rename, per-remote refspecs, mirrors) | secondary | **yes** | Remote inspector: edit URL, fetch refspec list, push refspec list; mirror toggle | → new issue (pairs with [#4](https://github.com/lobinuxsoft/yryvu/issues/4)) |
| 12 | Shallow / partial clone (`--depth`, `--filter`, unshallow) | secondary | **yes** | Clone dialog advanced section; repo toolbar shows "shallow" badge with "Unshallow" action | → new issue |
| 13 | Submodules (status, init, update, foreach, deinit) | secondary | **yes** | Sidebar "Submodules" section; per-submodule context menu; status bar shows dirty submodules count | [#21](https://github.com/lobinuxsoft/yryvu/issues/21) |
| 14 | Signed-commit verification UI (per-commit status, key fingerprint) | secondary | **yes** | Commit inspector badge + signature details; preferences for key trust; pairs with keys/profiles | [#22](https://github.com/lobinuxsoft/yryvu/issues/22) |
| 15 | Custom `git config` editor (system/global/local/include) with validation | absent | **yes** | Preferences tab "Git config" with scope selector, key search, validation hints | → new issue |
| 16 | Refspec editor for `fetch` / `push` (with preview) | absent | **yes (deferred)** | Nested inside remote inspector (row 11); dry-run preview pane | → new issue (pairs with row 11) |
| 17 | `git replace` and `git grafts` awareness | absent | **undecided** | Read-only badge on rewritten commits; palette `Replace: list / remove` | → new issue |
| 18 | `git archive` (export tree as tar/zip) | absent | **yes** | Branch/tag/commit context menu `Export as archive…` dialog | → new issue |
| 19 | `git range-diff` and `git patch-id` | absent | **yes (deferred)** | Compare dialog: "range-diff" mode; commit inspector shows `patch-id` | → new issue |
| 20 | `git bundle` (create / verify / unbundle) | absent | **yes (deferred)** | Repo menu `Share ▸ Create bundle…` / `Apply bundle…` | → new issue |
| 21 | Mailmap editor with effect preview | absent | **yes (deferred)** | Repo preferences tab "Authors"; live preview of remapped authors in graph | → new issue |

### Summary of decisions

- **`yes` (ship before v1.0):** 11 — bisect, reflog, worktree, format-patch/am,
  maintenance, hooks, LFS, multi-remote, shallow/partial, submodules,
  signed-commit UI, archive, custom config editor.
- **`yes (deferred)` (post-v1.0):** 6 — notes, rerere, refspec editor,
  range-diff/patch-id, bundle, mailmap editor.
- **`undecided` (needs user triage):** 2 — sparse-checkout, replace/grafts.
- **`no`:** 0 (so far — audit has not produced any Git capability rejected
  outright; the skipped set in [`ui-reference.md § 12`](ui-reference.md) is
  about GitKraken-proprietary features, not Git ones).

### Observations

- GitKraken's "hidden" category is effectively empty. Features it does not
  expose as first-class or secondary are simply **absent** — there is no
  Command Palette fallback to the underlying Git command. That means every
  row marked `absent` above represents a hard gap for GitKraken users who
  want to do the operation from the GUI.
- The `secondary` rows (worktree, multi-remote, shallow, submodules) all
  share a pattern: GitKraken exposes the **create** path but buries or omits
  the **manage** path. Yryvu should make the management surface first-class
  on all four.
- The `yes (deferred)` bucket is heavy on patch-workflow capabilities
  (notes, rerere, range-diff, bundle, mailmap). These matter for
  contributors to kernel-style mailing-list projects, which is a legitimate
  audience but not the primary one for a GUI client.

---

## 3. Open-source peer comparison

Peer coverage matrix. Values: `Y` = first-class or clearly exposed, `~` =
partial / buried, `N` = absent or unclear. Rows correspond to the capability
numbers in § 1. Peers surveyed:

- **GitLens** — VSCode extension (Eamodio).
- **GitUI** — TUI, Rust (extrawurst/gitui).
- **lazygit** — TUI, Go (jesseduffield/lazygit).
- **gitg** — GNOME GTK GUI.
- **Magit** — Emacs package.

| # | Capability | GitLens | GitUI | lazygit | gitg | Magit |
|---|---|:-:|:-:|:-:|:-:|:-:|
| 1 | bisect | ~ | N | Y | N | Y |
| 2 | reflog | Y | Y | Y | N | Y |
| 3 | worktree | ~ | Y | Y | N | Y |
| 4 | notes | ~ | N | N | N | Y |
| 5 | format-patch / am | N | N | Y | N | Y |
| 6 | sparse-checkout | N | N | N | N | ~ |
| 7 | rerere | N | N | N | N | Y |
| 8 | fsck / gc / maintenance | N | N | N | N | ~ |
| 9 | hooks | N | N | N | N | ~ |
| 10 | Git LFS | ~ | N | ~ | N | ~ |
| 11 | multi-remote / refspecs | ~ | ~ | Y | ~ | Y |
| 12 | shallow / partial clone | ~ | N | N | N | ~ |
| 13 | submodules | ~ | ~ | Y | N | Y |
| 14 | signed-commit verification | Y | ~ | ~ | N | Y |
| 15 | custom git config editor | ~ | N | N | N | ~ |
| 16 | refspec editor | N | N | ~ | N | Y |
| 17 | replace / grafts | N | N | N | N | ~ |
| 18 | archive | N | N | N | N | Y |
| 19 | range-diff / patch-id | ~ | N | N | N | Y |
| 20 | bundle | N | N | N | N | ~ |
| 21 | mailmap editor | N | N | N | N | N |

### Per-peer notes

- **GitLens**: strongest on read-side metadata (blame, history, commit
  inspector, signature verification). Weak on state-mutating ops that need
  prompts; defers most of those to VSCode's built-in Git or external terminal.
  Its `reflog` browser is a solid UX reference for Yryvu's row 2.
- **GitUI**: fast TUI with good worktree and reflog support. No patch-series,
  no notes, no bisect. Good reference for keyboard-first flows but does not
  close most of the gaps in this audit.
- **lazygit**: the most complete *operation* coverage among open-source
  peers. Bisect, worktree, submodules, cherry-pick, interactive rebase, and
  patch application are all first-class. It is the closest peer to Yryvu's
  stated scope and the single most useful comparison point for each row.
- **gitg**: minimal. Covers commit/push/pull/stage and little else. Included
  for completeness; do not mine it for UX ideas beyond the basic graph.
- **Magit**: the widest coverage of any client — it effectively wraps every
  Git command with a transient menu. Not a direct UX reference (Emacs-native
  interaction model), but it is a useful *completeness oracle*: if Magit
  exposes something and no GUI peer does, that row is a real gap.

### Usefulness of peers per capability

- **For bisect (row 1):** lazygit and Magit. Both expose a linear stepper
  with good/bad/skip actions; Yryvu's spec should lift the state machine
  from lazygit and the visualisation (highlighting candidate range) from
  the Magit transient.
- **For reflog (row 2):** GitLens reflog tree is the UX reference; lazygit
  shows the keyboard flow for restore-to-here.
- **For worktree (row 3):** lazygit's worktree panel is the best peer;
  Yryvu should exceed it by surfacing worktrees in the left sidebar rather
  than a separate view.
- **For hooks (row 9):** none of the peers expose hooks management as a
  first-class surface. This is a differentiation opportunity.
- **For mailmap (row 21):** no peer exposes it. Yryvu would be setting the
  reference here — ship only if the preview is actually useful; otherwise
  defer indefinitely.

### Peer calls flagged for verification

Several peer cells above are best-effort based on public documentation and
general familiarity. Rows that should be re-verified against current
versions before the matrix is accepted:

- GitLens — row 4 (notes), row 14 (verification depth), row 19 (range-diff
  support).
- lazygit — row 10 (LFS), row 11 (push refspec editing surface), row 16
  (refspec editor).
- Magit — row 8 (maintenance), row 15 (config editor depth), row 20
  (bundle).

These verifications are not blocking the deliverable; they are notes for
when the user accepts the matrix and commits to follow-up issues.

---

## 4. Follow-up issues — deferred

See the status section at the top of this document. No follow-up issues are
created in this pass. When the user signs off on the matrix, open one issue
per `yes` / `yes (deferred)` row that does not already have a covering
issue. Each new issue must include a pointer line of the form:

```
> Capability not in UI reference; see docs/git-capability-audit.md § 1 row N.
```

Rows with existing coverage and therefore no new issue needed:

- Row 3 (worktree) → [#20](https://github.com/lobinuxsoft/yryvu/issues/20).
- Row 10 (Git LFS) → [#21](https://github.com/lobinuxsoft/yryvu/issues/21).
- Row 13 (submodules) → [#21](https://github.com/lobinuxsoft/yryvu/issues/21).
- Row 14 (signed-commit verification) → pair with
  [#22](https://github.com/lobinuxsoft/yryvu/issues/22).
