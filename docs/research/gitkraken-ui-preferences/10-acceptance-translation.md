# 10 — Acceptance translation: #103 → chajá sub-issues

This is the bridge from research to plan. The current #103 issue body
covers six sub-settings (theme, zoom, font, density, tooltips,
animation). The audit reveals:

- 1 of those (theme) has a deep GK port surface.
- 2 of those (zoom, font) have GK port surfaces but in different
  panels / different scopes (zoom = status bar, font = editor panel).
- 3 of those (density, tooltips, animation) have **no GK analogue**.

Plus one out-of-scope item the audit surfaces: the existing chajá
`Preferences > UI` panel is a stub (`apps/chaja-app/src/components/PreferencesWindow/panels/Ui.tsx`)
that needs a full render contract.

## Recommended sub-issue split

#103 stays as the umbrella. Split into 5 sub-issues, each with a
single-PR scope:

### Sub-issue A: Theme system (the largest)

**Title**: `feat(preferences): theme system — 10 built-in themes,
auto-OS-follow, live-apply`

**Scope**:

1. Add `Preferences.ui.theme: ThemeId` enum to
   `crates/chaja-bridge/src/preferences.rs`. Variants: `Auto` plus
   the 10 theme ids.
2. Port the 10 design-previews `:root` blocks into a single
   `apps/chaja-app/src/styles/themes.css` (or 10 lazy-loaded files —
   see doc 12 for the choice).
3. Bundle FiraCode Nerd Font Mono (already in
   `design-previews/preferences-themes/fonts/`) into
   `apps/chaja-app/public/fonts/` and reference from
   `tokens.css` / `themes.css`.
4. Add a `themeId` Solid signal in
   `apps/chaja-app/src/state/preferences.ts` (or wherever the
   preferences store lives).
5. Add an `effect` that:
   - On startup: reads the saved theme id, resolves `auto` to a
     concrete id via `prefers-color-scheme`, sets
     `document.documentElement.dataset.theme`.
   - On change: same mutation.
   - Listens to `window.matchMedia('(prefers-color-scheme: dark)')`
     change events when current id is `auto`.
6. Add the `<select>` row to
   `apps/chaja-app/src/components/PreferencesWindow/panels/Ui.tsx`,
   wired to the signal.
7. Add i18n strings (chajá has `es` + `en` baseline).

**Acceptance**:
- Picking any of 11 options (10 themes + auto) live-applies without
  reload.
- `auto` correctly tracks OS dark/light changes.
- Selection persists across app restarts.
- All existing chajá UI surfaces (toolbar, left panel, status bar,
  ColdStart, RepoManagement) render correctly under each of the 10
  themes — no token misses.

**Difficulty**: medium. ~400 LOC across CSS + Rust + TS.

### Sub-issue B: Zoom

**Title**: `feat(preferences): UI zoom — 80% to 130% in 10% steps`

**Scope**:

1. Add `Preferences.ui.zoom: f32` (default 1.0) to the struct.
2. Add zoom apply mechanism. **Recommendation**: ship Option A (root
   font-size on `<html>`) AFTER a separate `chore(styles): migrate
   px to rem` PR lands. If that PR is too far out, ship Option B
   (CSS `zoom`) for v1 and file the rem migration as follow-up.
3. Add `<select>` row to the panel with the 6 GK ladder values.
4. Apply on startup (single effect that fires once when preferences
   load completes).

**Acceptance**:
- All 6 values render correctly.
- Persists across restarts.
- 100% is default.

**Difficulty**: easy. ~80 LOC. (Larger if shipping the rem migration
PR concurrently — that's a separate sub-issue.)

### Sub-issue C: Density

**Title**: `feat(preferences): UI density — comfortable / compact`

**Scope**:

1. Add `Preferences.ui.density: Density` enum.
2. Add `:root[data-density="compact"]` override block to
   `tokens.css` (or `themes.css`) reducing the tokens listed in
   doc 02.
3. Add `<select>` row.
4. Add `effect` setting `document.documentElement.dataset.density`.

**Acceptance**:
- Density change live-applies without reload.
- All chajá UI surfaces visually scale correctly under compact (no
  clipping, no horizontal scroll appearing).
- Comfortable matches the design-previews exactly.

**Difficulty**: easy-medium. ~100 LOC + a screenshot diff to verify
no clipping.

### Sub-issue D: Tooltips + animations (combined)

**Title**: `feat(preferences): tooltip behavior + animation mode`

**Scope**:

1. Add to struct:
   ```rust
   pub tooltips_enabled: bool,
   pub tooltip_delay_ms: u16,
   pub animations: AnimationMode,
   ```
2. Implement / refactor `<Tooltip>` component to read both signals.
   Audit existing tooltips:
   - Grep `apps/chaja-app/src/` for `title=` and existing
     `<Tooltip>` usages. Document the count in the PR description.
3. Add the `data-animations` attribute mechanism + the CSS
   override block from doc 04.
4. Add the spinner exemption (the `loading-spinner.css` rule needs
   its `animation` declaration to win even under `data-animations="never"`).
5. Add 3 panel rows: tooltip checkbox, tooltip delay number input,
   animation `<select>`.

**Acceptance**:
- Disabling tooltips removes them visually but keeps `aria-label`.
- Tooltip delay change reflects in next hover.
- Animation `never` removes all transitions/animations site-wide
  except the loading spinner.
- Animation `system` correctly tracks OS `prefers-reduced-motion`.

**Difficulty**: medium. ~200 LOC across TS (Tooltip refactor) +
CSS (animation overrides).

### Sub-issue E (deferred — NOT in #103 v1)

**Title**: `feat(preferences): editor font (defer until editor ships)`

**Scope**: not filed in #103 cluster. File it as part of cluster
#256 / #257 (diff editor / commit editor) when those land. Doc 06
explains the rationale.

## Sub-PR structure within umbrella #103

```
#103 (umbrella, stays open)
├── PR 1: Sub-issue A — Theme system            (largest, lands first)
├── PR 2: Sub-issue B — Zoom                    (independent)
├── PR 3: Sub-issue C — Density                 (depends on PR 1's stylesheet structure)
└── PR 4: Sub-issue D — Tooltips + animations   (independent)
```

PR 1 is the biggest because it establishes the panel render contract
(the `<PreferenceRow>` component is added by PR 1). PRs 2, 3, 4 each
add a row to the existing panel. Order:

- PR 1 must land first (creates the panel structure).
- PRs 2, 3, 4 can land in any order after PR 1.

Each PR is "single commit per sub-task per the commit-per-subtask
feedback rule".

## Stylistic alignment

- All commits English Conventional, NO AI signatures (per
  `workflow.md`).
- PRs base `development`, merge with `--merge`.
- Each sub-PR closes its own sub-issue (umbrella stays open until
  last sub-PR).
- 400 LOC cap on every changed source file.
- All Rust new code: `#[serde(rename_all = "camelCase")]`,
  `#[serde(default)]` on new fields, default impls preserved.
- All TS new code: types in TS files, no `any`.
- Solid signals: prefer `createSignal` over `createMemo` for simple
  boolean flags; `createMemo` for derived theme-id when `auto` is
  resolving.

## Open questions for the auditor (decide before sub-PR 1 opens)

These are decisions the auditor / user should make BEFORE sub-PR A
opens, not deferred:

1. **Theme apply mechanism**: single `themes.css` with all 10 selector
   blocks (~20KB always loaded) vs 10 lazy-loaded files. Recommendation:
   single file (no async surface, faster theme switch, marginal cost).
2. **Zoom apply mechanism**: rem migration first (cleaner long-term)
   vs CSS `zoom` for v1 (faster ship). Recommendation: CSS `zoom`
   for v1, rem migration as follow-up.
3. **Tooltip refactor scope**: refactor every existing `title=` site
   in PR D, or land the framework only and migrate sites in follow-ups.
   Recommendation: framework + migrate every site in the same PR
   (~30-50 sites by current chajá codebase size; one PR is fine).
4. **`auto` theme: which dark / light theme does it resolve to?**
   Recommendation: `a-default` for dark, `e-rose-pine-dawn` for light.
   This is the only light-scheme theme in the 10, so the choice is
   forced. If a second light theme ships, the resolver picks the
   first (alphabetic id) — document this in the doc 01.
5. **Spinner under `animations="never"`**: special-case (keep
   spinning) or honor (static)? Recommendation: special-case. Loading
   feedback > motion-reduction in this one corner.
