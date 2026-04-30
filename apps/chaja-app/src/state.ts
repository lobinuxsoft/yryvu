// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createResource, createSignal, type Signal } from "solid-js";

import {
  getPreferences,
  getUndoRedoState,
  getWorkingTreeStatus,
  resetPreferences as ipcResetPreferences,
  setPreferences as ipcSetPreferences,
  type GeneralPreferences,
  type Preferences,
  type UiPreferences,
  type UndoRedoState,
  type WorkingTreeStatus,
} from "./ipc";
import {
  ALL_ZONES,
  clampZoneWidth,
  compactColumnLayout,
  defaultColumnLayout,
  orderedVisibleZones,
  type ColumnSettings,
  type CommitZoneMode,
  type GraphZoneId,
} from "./components/CommitGraph/columns";

const STORAGE_PREFIX = "chaja.";
const STORAGE_RECENT_KEY = `${STORAGE_PREFIX}recentRepos`;

function persistedBool(key: string, fallback: boolean): Signal<boolean> {
  const stored = localStorage.getItem(STORAGE_PREFIX + key);
  const initial = stored === null ? fallback : stored === "1";
  const [value, setValue] = createSignal(initial);
  const wrapped: Signal<boolean>[1] = ((next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(value()) : next;
    localStorage.setItem(STORAGE_PREFIX + key, resolved ? "1" : "0");
    return setValue(resolved);
  }) as Signal<boolean>[1];
  return [value, wrapped];
}

function persistedEnum<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): Signal<T> {
  const stored = localStorage.getItem(STORAGE_PREFIX + key);
  const initial = stored !== null && (allowed as readonly string[]).includes(stored)
    ? (stored as T)
    : fallback;
  const [value, setValue] = createSignal<T>(initial);
  const wrapped: Signal<T>[1] = ((next: T | ((prev: T) => T)) => {
    const resolved = typeof next === "function" ? (next as (prev: T) => T)(value()) : next;
    localStorage.setItem(STORAGE_PREFIX + key, resolved);
    return setValue(() => resolved);
  }) as Signal<T>[1];
  return [value, wrapped];
}

export const [showLeftPanel, setShowLeftPanel] = persistedBool("showLeftPanel", true);
export const [showRightPanel, setShowRightPanel] = persistedBool("showRightPanel", true);
export const [showTerminalPanel, setShowTerminalPanel] = persistedBool("showTerminalPanel", false);

/// Collapse state for the Unstaged / Staged sections in the commit panel.
/// Persisted globally (not per-repo) — GK persists per-repo but the extra
/// bookkeeping is overkill until users ask for it.
export const [unstagedFilesCollapsed, setUnstagedFilesCollapsed] =
  persistedBool("unstagedFilesCollapsed", false);
export const [stagedFilesCollapsed, setStagedFilesCollapsed] = persistedBool(
  "stagedFilesCollapsed",
  false,
);

/// `Commit Options` collapsible (skip hooks / GPG sign) below the message
/// box. Matches GK's `getPendingCommitOptionsExpanded`.
export const [pendingCommitOptionsExpanded, setPendingCommitOptionsExpanded] =
  persistedBool("pendingCommitOptionsExpanded", false);

/// Bypass pre-commit hooks. No-op on the git2 backend (libgit2 never
/// invokes hooks) but wired through for frontend/backend parity and so
/// future-gix migration picks up the flag for free.
export const [skipHooksEnabled, setSkipHooksEnabled] = persistedBool(
  "skipHooksEnabled",
  false,
);

export type Theme = "dark" | "light";

function persistedTheme(): Signal<Theme> {
  const stored = localStorage.getItem(STORAGE_PREFIX + "theme");
  const initial: Theme = stored === "light" ? "light" : "dark";
  const [value, setValue] = createSignal<Theme>(initial);
  const wrapped: Signal<Theme>[1] = ((next: Theme | ((prev: Theme) => Theme)) => {
    const resolved = typeof next === "function" ? next(value()) : next;
    localStorage.setItem(STORAGE_PREFIX + "theme", resolved);
    return setValue(resolved);
  }) as Signal<Theme>[1];
  return [value, wrapped];
}

export const [theme, setTheme] = persistedTheme();

const [repoPath, setRepoPathRaw] = createSignal<string | undefined>(undefined);
export { repoPath };

/// Swap the active repository. Clears every per-repo ephemeral signal
/// (selection, hovered ref, inspector mode, draft commit message,
/// amend, …) so stale state from the previous repo doesn't leak — the
/// classic repro was clicking commits after a switch and nothing
/// responding because `selectedCommit` still pointed at a SHA that
/// didn't exist in the new repo, which in turn pinned the WIP
/// calculations and inspector resources on ghost data.
///
/// Must live near the bottom of the signal declarations because it
/// writes into several setters declared below. Exported as a function so
/// call sites stay stable.
export function setRepoPath(next: string | undefined): void {
  const prev = repoPath();
  setRepoPathRaw(next);
  if (prev === next) return;
  clearSelection();
  setSelectedDiffFile(undefined);
  setHoveredRef(undefined);
  setPinnedSha(undefined);
  setInspectorMode("details");
  setCommitMessage("");
  setCommitDescription("");
  setAmendEnabled(false);
  // Invalidate the WIP resource so the previous repo's working-tree
  // status doesn't leak across the switch (the WIP cell + right-panel
  // staging UI used to show the old repo's dirty files until the new
  // fetch resolved). createResource keeps the prior value during a
  // refetch by design — we explicitly null it here.
  mutateWorkingTreeStatus(undefined);
  // Same reasoning for the undo/redo button state — the previous
  // repo's `Undo` label would otherwise flash on the toolbar until
  // the new sidecar fetch resolves.
  mutateUndoRedoState(undefined);
}

/// Selection model — multi-row selection plus the WIP pseudo-row.
///
/// `selectedShasInternal` is **youngest-first** (matches the order the
/// frontend selects rows in: a plain click puts the new sha at index 0,
/// Ctrl+click prepends, Shift+range walks rows in row-index order). The
/// backend's `combined_commit_diff` consumes the same orientation so no
/// reordering happens at the IPC boundary.
///
/// `selectionAnchorInternal` is the row Shift+click extends from. Plain
/// click resets it to the clicked sha; Ctrl+click leaves it untouched
/// (matches GitKraken / Finder convention).
const [selectedShasInternal, setSelectedShasInternal] = createSignal<string[]>([]);
const [workdirSelectedInternal, setWorkdirSelectedInternal] =
  createSignal<boolean>(false);
const [selectionAnchorInternal, setSelectionAnchorInternal] = createSignal<
  string | undefined
>(undefined);

export const selectedShas = selectedShasInternal;
export const workdirSelected = workdirSelectedInternal;
export const selectionAnchor = selectionAnchorInternal;

/// Youngest-selected sha, or `undefined` when nothing committed is
/// selected. Backward-compatible accessor for callers (right panel
/// resources, sidebar, toolbar) that still operate on a single sha.
export const selectedCommit = createMemo<string | undefined>(
  () => selectedShasInternal()[0],
);

/// Replace the selection wholesale. `shas` is youngest-first. `workdir`
/// flips the WIP pseudo-row's inclusion. The anchor follows the youngest
/// sha (or `undefined` when only the workdir is selected) so a follow-up
/// Shift+click extends from the most-recently-set row.
export function setSelection(shas: string[], workdir: boolean): void {
  setSelectedShasInternal(shas);
  setWorkdirSelectedInternal(workdir);
  setSelectionAnchorInternal(shas[0]);
}

/// Single-row select. Replaces any existing selection and clears the
/// workdir bit. Kept under the legacy `setSelectedCommit` name so existing
/// call sites (sidebar pulse, toolbar branch-jump, commit-context-menu
/// follow-up) need no churn.
export function setSelectedCommit(sha: string | undefined): void {
  if (sha === undefined) {
    setSelection([], false);
    return;
  }
  setSelection([sha], false);
}

/// Ctrl/Cmd+click — toggle `sha` in/out of the committed selection
/// without touching the workdir bit or the anchor.
export function toggleCommitInSelection(sha: string): void {
  const cur = selectedShasInternal();
  const idx = cur.indexOf(sha);
  if (idx >= 0) {
    const next = cur.slice();
    next.splice(idx, 1);
    setSelectedShasInternal(next);
    return;
  }
  setSelectedShasInternal([sha, ...cur]);
}

/// Shift+click — extend the selection from `selectionAnchor` to `sha`
/// using `orderedShas` (youngest-first; the order rows appear in the
/// graph). The walked range is appended to the existing selection,
/// de-duped while preserving youngest-first order. Without an anchor the
/// call collapses to a plain single-select on `sha`.
export function selectRangeTo(sha: string, orderedShas: string[]): void {
  const anchor = selectionAnchorInternal();
  if (!anchor || anchor === sha) {
    setSelectedCommit(sha);
    return;
  }
  const aIdx = orderedShas.indexOf(anchor);
  const bIdx = orderedShas.indexOf(sha);
  if (aIdx < 0 || bIdx < 0) {
    setSelectedCommit(sha);
    return;
  }
  const [lo, hi] = aIdx <= bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
  const range = orderedShas.slice(lo, hi + 1);
  // Existing selection wins on the head so the user's pre-shift picks
  // stay at the top; range tail is filtered against the existing set.
  const cur = selectedShasInternal();
  const seen = new Set(cur);
  const merged = cur.slice();
  for (const s of range) {
    if (!seen.has(s)) {
      merged.push(s);
      seen.add(s);
    }
  }
  setSelectedShasInternal(merged);
  // Anchor stays put — successive Shift+clicks all extend from the
  // original anchor (matches GK / Finder behaviour).
}

/// Toggle the WIP pseudo-row in the multi-select. Used by the WIP cell's
/// Ctrl/Cmd+click handler when the user wants to combine "this commit"
/// with "everything I haven't committed yet".
export function toggleWorkdirInSelection(): void {
  setWorkdirSelectedInternal((v) => !v);
}

/// Clear committed + workdir selection and the anchor.
export function clearSelection(): void {
  setSelectedShasInternal([]);
  setWorkdirSelectedInternal(false);
  setSelectionAnchorInternal(undefined);
}

export type MainView = "graph" | "diff";
export const [mainView, setMainView] = createSignal<MainView>("graph");

export type SelectedDiffFile =
  | { kind: "commit"; sha: string; path: string }
  | { kind: "staging"; side: "unstaged" | "staged"; path: string };

export const [selectedDiffFile, setSelectedDiffFile] = createSignal<
  SelectedDiffFile | undefined
>(undefined);

export function openDiffTab(sha: string, path: string) {
  setSelectedDiffFile({ kind: "commit", sha, path });
  setMainView("diff");
}

export function openStagingDiffTab(
  side: "unstaged" | "staged",
  path: string
) {
  setSelectedDiffFile({ kind: "staging", side, path });
  setMainView("diff");
}

export function closeDiffTab() {
  setSelectedDiffFile(undefined);
  setMainView("graph");
}

/// Inspector mode — "details" shows the selected commit; "staging" shows the
/// Unstaged/Staged file lists. Toggled by the WIP banner's View Changes button.
export type InspectorMode = "details" | "staging";
export const [inspectorMode, setInspectorMode] =
  createSignal<InspectorMode>("details");

/// Bumped whenever a staging-mutating op completes, so resources watching
/// working-tree status re-fetch.
export const [workingTreeNonce, setWorkingTreeNonce] = createSignal(0);
export function refreshWorkingTree() {
  setWorkingTreeNonce((n) => n + 1);
}

/// Bumped after every undo / redo IPC so the toolbar's button-state
/// resource refetches and the buttons reflect the new cursor position.
/// Also bumped by graph / branches / working-tree refreshes so a user
/// committing through the toolbar sees Undo enable on the next tick.
export const [undoRedoNonce, setUndoRedoNonce] = createSignal(0);
export function refreshUndoRedo() {
  setUndoRedoNonce((n) => n + 1);
}

const [workingTreeStatusInternal, { mutate: mutateWorkingTreeStatus }] =
  createResource<WorkingTreeStatus | undefined, [string, number]>(
    () => {
      const p = repoPath();
      return p ? ([p, workingTreeNonce()] as [string, number]) : undefined;
    },
    async ([p]) => await getWorkingTreeStatus(p),
  );

export const workingTreeStatus = workingTreeStatusInternal;

// undoRedoState resource is defined later — `graphNonce` / `branchesNonce`
// must be declared first since the source-key tracks them. See the
// definition further down, near the bottom of the signal block.
let mutateUndoRedoState: (next: UndoRedoState | undefined) => unknown = () => {};

/// Draft commit message — two-way bound between the WIP row's input and the
/// inspector commit panel.
export const [commitMessage, setCommitMessage] = createSignal("");
export const [commitDescription, setCommitDescription] = createSignal("");
export const [amendEnabled, setAmendEnabled] = createSignal(false);

/// Bumped after any commit-creating op so CommitGraph re-streams.
export const [graphNonce, setGraphNonce] = createSignal(0);
export function refreshGraph() {
  setGraphNonce((n) => n + 1);
}

/// Bumped after any ref-mutating op (branch create/rename/delete, tag
/// create, …) so the sidebar branch list and repo-state banner re-fetch.
export const [branchesNonce, setBranchesNonce] = createSignal(0);
export function refreshBranches() {
  setBranchesNonce((n) => n + 1);
}

/// Toolbar Undo / Redo button state. Reads the per-repo sidecar via
/// `get_undo_redo_state` whenever:
///
///   - the repo path changes,
///   - `undoRedoNonce` bumps (an undo / redo just ran), OR
///   - any of the other refresh nonces bumps (a tracked op landed —
///     commit / checkout / reset / merge / stash all bump at least one
///     of `graphNonce`, `branchesNonce`, or `workingTreeNonce`).
///
/// Tracking the other nonces keeps the toolbar buttons honest without
/// having to thread an explicit `refreshUndoRedo` call through every
/// op handler. Refetches are cheap (single JSON read).
const [undoRedoStateInternal, undoRedoStateActions] = createResource<
  UndoRedoState | undefined,
  [string, number]
>(
  () => {
    const p = repoPath();
    if (!p) return undefined;
    // Compose all four nonces into a single key. Solid only refetches on
    // reference inequality, so a mutation that bumps any one of them
    // produces a new tuple identity and triggers the read.
    return [
      p,
      undoRedoNonce() + graphNonce() + branchesNonce() + workingTreeNonce(),
    ] as [string, number];
  },
  async ([p]) => await getUndoRedoState(p),
);
mutateUndoRedoState = undoRedoStateActions.mutate;
export const undoRedoState = undoRedoStateInternal;

/// The ref the cursor is hovering (either a pill in the graph's BRANCH/TAG
/// column or a row in the sidebar). Drives the graph's hover-dim effect
/// (#54) — commits that aren't ancestors of the hovered ref fade to a low
/// opacity, so the user can see at a glance which commits "belong to"
/// that branch/tag.
///
/// Matches GitKraken's `isMissingHoveredRefGroup` selector (doc 08 / bundle
/// `Gd` row wrapper): the membership test uses the row's own refs first,
/// then falls back to the pre-computed `child_refs` propagated bottom-up
/// by `graph-core::populate_child_refs`.
export type HoveredRefKind = "head" | "remote" | "tag";
export interface HoveredRef {
  kind: HoveredRefKind;
  name: string;
}
export const [hoveredRef, setHoveredRef] = createSignal<HoveredRef | undefined>(
  undefined,
);
export function clearHoveredRef() {
  setHoveredRef(undefined);
}

/// SHA of the trunk pin chosen by the backend's `pick_pinned_head`. Written
/// once per repo by the graph stream's `onPinned` callback; consumed by the
/// ref-pill ordering pass to surface the pinned-branch annotation (doc 06
/// stage 2). `undefined` until the first stream batch arrives, or for repos
/// with no resolvable trunk (detached HEAD + no remote default).
export const [pinnedSha, setPinnedSha] = createSignal<string | undefined>(
  undefined,
);

/// Refs the user has hidden from the graph via the ref-pill context menu.
/// Keyed by `<kind>/<name>` so tags and branches with colliding names stay
/// distinct (matches the GK bundle's per-(kind,name) tracking). Persisted
/// globally — GK persists per-repo but until profile-level prefs land the
/// extra bookkeeping is overkill, and the cost of carrying a stale entry
/// across repo switches is just an empty filter pass.
const HIDDEN_REFS_KEY = `${STORAGE_PREFIX}hiddenRefs`;

function loadHiddenRefs(): Set<string> {
  const raw = localStorage.getItem(HIDDEN_REFS_KEY);
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set<string>(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set<string>();
  }
}

const [hiddenRefsInternal, setHiddenRefsInternal] =
  createSignal<Set<string>>(loadHiddenRefs());

export const hiddenRefs = hiddenRefsInternal;

function persistHiddenRefs(next: Set<string>): void {
  localStorage.setItem(HIDDEN_REFS_KEY, JSON.stringify(Array.from(next)));
}

export function setHiddenRef(key: string, hidden: boolean): void {
  const next = new Set(hiddenRefsInternal());
  if (hidden) next.add(key);
  else next.delete(key);
  persistHiddenRefs(next);
  setHiddenRefsInternal(next);
}

export function clearHiddenRefs(): void {
  const empty = new Set<string>();
  persistHiddenRefs(empty);
  setHiddenRefsInternal(empty);
}

/// Graph column system. Two pieces of state, separately persisted:
///
/// 1. `graphColumns` — the active layout (width / visible / order per
///    zone). Resize handles, visibility toggles, and the two `Reset
///    columns to …` actions all write here.
///
/// 2. `commitZoneMode` — `text` | `compact`. Sole observer is the
///    GRAPH zone's renderer (controls lane / circle compactness). 1:1
///    with GK's `setZoneColumnMode(commitZone, …)` sa.
///
/// `Reset columns to compact layout` overwrites `graphColumns` with the
/// compact preset (which reorders author left of message and hides
/// dateTime) AND switches `commitZoneMode` to compact. The standalone
/// `Compact Graph Column` toggle only flips `commitZoneMode` — column
/// order / visibility / widths stay on whatever the user has now.
const COLUMN_LAYOUT_KEY = `${STORAGE_PREFIX}graphColumnLayout`;
const COMMIT_ZONE_MODE_KEY = `${STORAGE_PREFIX}commitZoneMode`;

function loadColumnLayout(): Record<GraphZoneId, ColumnSettings> {
  const fallback = defaultColumnLayout();
  const raw = localStorage.getItem(COLUMN_LAYOUT_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const out = { ...fallback };
    for (const id of ALL_ZONES) {
      const candidate = (parsed as Record<string, Partial<ColumnSettings>>)[id];
      if (!candidate || typeof candidate !== "object") continue;
      const merged: ColumnSettings = { ...out[id] };
      if (typeof candidate.width === "number") {
        merged.width = clampZoneWidth(id, candidate.width);
      }
      if (typeof candidate.visible === "boolean") merged.visible = candidate.visible;
      if (typeof candidate.order === "number") merged.order = candidate.order;
      out[id] = merged;
    }
    return out;
  } catch {
    return fallback;
  }
}

function loadCommitZoneMode(): CommitZoneMode {
  return localStorage.getItem(COMMIT_ZONE_MODE_KEY) === "compact" ? "compact" : "text";
}

const [graphColumnsInternal, setGraphColumnsInternal] = createSignal<
  Record<GraphZoneId, ColumnSettings>
>(loadColumnLayout());
const [commitZoneModeInternal, setCommitZoneModeInternal] =
  createSignal<CommitZoneMode>(loadCommitZoneMode());

export const graphColumns = graphColumnsInternal;
export const commitZoneMode = commitZoneModeInternal;

function persistLayout(next: Record<GraphZoneId, ColumnSettings>): void {
  localStorage.setItem(COLUMN_LAYOUT_KEY, JSON.stringify(next));
  setGraphColumnsInternal(next);
}

/// Active settings for a given zone — reads the live `graphColumns` map.
export const activeColumnSettings = (id: GraphZoneId): ColumnSettings =>
  graphColumnsInternal()[id];

/// Visible zones in left-to-right render order, derived from the live
/// layout map. Reactive on width / visibility / order changes.
export const activeOrderedZones = (): GraphZoneId[] =>
  orderedVisibleZones(graphColumnsInternal());

/// Resize a column. Mirrors GK's `adjustResizedGraphZone` —
/// `expandZoneWidthsToFitWidth` / `shrinkZoneWidthsToFitWidth` cascade
/// (bundle ~458970): the delta absorbed by the resized zone is paid
/// back to (or taken from) the visible zones to its right, in order,
/// each zone clamped to its own `[minimumWidth, maximumWidth]`. When
/// the cascade hits the right edge with delta still to spend, the
/// remainder stays on the resized zone (so the user feels a hard stop
/// rather than the column spilling through other columns).
export function setGraphZoneWidth(id: GraphZoneId, width: number): void {
  const cur = graphColumnsInternal();
  const ordered = orderedVisibleZones(cur);
  const idx = ordered.indexOf(id);
  if (idx < 0) {
    // Resizing a hidden zone — write straight through, no cascade.
    persistLayout({
      ...cur,
      [id]: { ...cur[id], width: clampZoneWidth(id, width) },
    });
    return;
  }

  const oldWidth = cur[id].width;
  const requestedNew = clampZoneWidth(id, width);
  const next: Record<GraphZoneId, ColumnSettings> = {
    ...cur,
    [id]: { ...cur[id], width: requestedNew },
  };
  // Positive `slack` means the resized zone shrunk — neighbours to the
  // right need to grow by that much. Negative means it grew — they need
  // to shrink. Walk in left-to-right order so the closest neighbour
  // absorbs first (matches GK; the user feels the resize "push" the
  // adjacent column rather than re-flowing the far end of the row).
  let slack = oldWidth - requestedNew;
  for (let i = idx + 1; i < ordered.length && slack !== 0; i += 1) {
    const rid = ordered[i];
    const r = next[rid];
    const desired = r.width + slack;
    const clamped = clampZoneWidth(rid, desired);
    const consumed = clamped - r.width;
    next[rid] = { ...r, width: clamped };
    slack -= consumed;
  }
  // If `slack` is still non-zero, every column to the right is at its
  // bound. Reflect that on the resized zone — the user can't go past
  // what the cascade can absorb.
  if (slack !== 0) {
    const finalSelf = clampZoneWidth(id, requestedNew + slack);
    next[id] = { ...next[id], width: finalSelf };
  }
  persistLayout(next);
}

/// Toggle a zone's visibility.
export function setGraphZoneVisible(id: GraphZoneId, visible: boolean): void {
  const cur = graphColumnsInternal();
  persistLayout({ ...cur, [id]: { ...cur[id], visible } });
}

/// Flip the GRAPH zone's compact rendering mode. Affects only the graph
/// zone's lane / node sizing — column order, visibility, and widths
/// elsewhere are untouched. 1:1 with GK's `Compact Graph Column` toggle.
export function setCommitZoneMode(mode: CommitZoneMode): void {
  localStorage.setItem(COMMIT_ZONE_MODE_KEY, mode);
  setCommitZoneModeInternal(mode);
}

export function toggleCommitZoneMode(): void {
  setCommitZoneMode(commitZoneModeInternal() === "compact" ? "text" : "compact");
}

/// `Reset columns to default layout` action. Overwrites the layout
/// with bundle defaults and forces the graph zone back to text mode.
export function resetColumnsToDefaultLayout(): void {
  persistLayout(defaultColumnLayout());
  setCommitZoneMode("text");
}

/// `Reset columns to compact layout` action. Overwrites the layout
/// with the compact preset (author moves left of message; dateTime
/// is hidden) and switches the graph zone to compact rendering.
export function resetColumnsToCompactLayout(): void {
  persistLayout(compactColumnLayout());
  setCommitZoneMode("compact");
}

/// Toolbar Pull split-button preference. Mirrors GitKraken's
/// `pullType` profile setting (`/tmp/gk-bundle-pretty.js:10511`).
/// Backend `MergeStrategy` value the main button runs when clicked;
/// `fetch` is a chajá deviation that wraps `fetch_prune` instead of a
/// merge. `force_pull` is also chajá-specific (5th item).
export type PullType =
  | "fetch"
  | "pull_merge"
  | "pull_ff_only"
  | "pull_rebase"
  | "force_pull";

const PULL_TYPES: readonly PullType[] = [
  "fetch",
  "pull_merge",
  "pull_ff_only",
  "pull_rebase",
  "force_pull",
];

export const [pullType, setPullType] = persistedEnum<PullType>(
  "pullType",
  "pull_merge",
  PULL_TYPES,
);

/// Smart Branch Visibility — global toggle that drives a 1:1 port of
/// GitKraken's `SmartBranchesService.resolveAllowedRefs`. When enabled,
/// `CommitGraph` invokes the backend `smart_visible_refs` IPC and stores
/// the complement (every ref *not* in the allowed set) in
/// `hiddenBySmartFilter` so `RefPillGroup` can filter without recomputing.
/// Persistence is profile-wide via `localStorage` (chajá has no
/// per-profile config yet; matches GK's `["ui","graphOptions",
/// "smartBranches"]` semantics functionally).
export const [smartBranchesEnabled, setSmartBranchesEnabled] = persistedBool(
  "smartBranchesEnabled",
  false,
);

/// Set of `${kind}/${name}` keys hidden by the Smart Branch Visibility
/// filter. Computed by `CommitGraph` whenever the IPC resolves a new
/// allowlist. Empty when the toggle is off so RefPillGroup short-circuits.
/// The set is *additive* with `hiddenRefs` (manual user hides) — chajá
/// keeps the two filters separate, unlike GK which writes both to the
/// repo-level `soloedRefs` setting.
const [hiddenBySmartFilterInternal, setHiddenBySmartFilterInternal] =
  createSignal<Set<string>>(new Set());
export const hiddenBySmartFilter = hiddenBySmartFilterInternal;

export function setHiddenBySmartFilter(next: Set<string>): void {
  setHiddenBySmartFilterInternal(next);
}

export const dirtyFileCount = createMemo(() => {
  const s = workingTreeStatus();
  if (!s) return 0;
  const paths = new Set<string>();
  s.unstaged.forEach((c) => paths.add(c.path));
  s.staged.forEach((c) => paths.add(c.path));
  return paths.size;
});

export interface RecentRepo {
  path: string;
  name: string;
  openedAt: number;
}

export function loadRecentRepos(): RecentRepo[] {
  const raw = localStorage.getItem(STORAGE_RECENT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function pushRecentRepo(path: string): RecentRepo[] {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  const entry: RecentRepo = { path, name, openedAt: Date.now() };
  const list = loadRecentRepos().filter((r) => r.path !== path);
  list.unshift(entry);
  const trimmed = list.slice(0, 10);
  localStorage.setItem(STORAGE_RECENT_KEY, JSON.stringify(trimmed));
  return trimmed;
}

/// Remove one path from the recent-repos cache. Used by Repo Management
/// when the user clears a stale entry (deleted directory, moved repo)
/// or bulk-removes a selection.
export function removeRecentRepo(path: string): RecentRepo[] {
  const list = loadRecentRepos().filter((r) => r.path !== path);
  localStorage.setItem(STORAGE_RECENT_KEY, JSON.stringify(list));
  return list;
}

// =============================================================================
// Preferences window (issue #136 — 1:1 port of GK's PreferenceView)
// =============================================================================

/// Section IDs accepted by chajá from GK's `tabTypes` enum. AGENTS / CLI /
/// GITKRAKEN_AI / ORGANIZATION / TEAM_SETTINGS are filtered out as
/// GK-proprietary per the coverage matrix in #136.
export const PREFERENCE_SECTION_IDS = [
  "general",
  "ui",
  "commit",
  "editor",
  "encoding",
  "conflict_detection",
  "experimental",
  "gpg",
  "gitflow",
  "githooks",
  "integrations",
  "issue_tracker",
  "lfs",
  "notifications",
  "profiles",
  "sparse_checkout",
  "ssh",
  "submodules",
  "tools",
] as const;

export type PreferenceSectionId = (typeof PREFERENCE_SECTION_IDS)[number];

export const [preferencesOpen, setPreferencesOpen] = createSignal(false);

export const [activePreferenceSection, setActivePreferenceSection] = persistedEnum<
  PreferenceSectionId
>("activePreferenceSection", "general", PREFERENCE_SECTION_IDS);

export function openPreferences(section?: PreferenceSectionId): void {
  if (section) setActivePreferenceSection(section);
  setPreferencesOpen(true);
}

export function closePreferences(): void {
  setPreferencesOpen(false);
}

/// Backend-persisted preferences. Loaded once on app startup; subsequent
/// edits go through `updatePreferences` / `resetPreferences` which save
/// atomically backend-side and mutate this resource on success.
const [preferences, { mutate: mutatePreferencesResource }] = createResource<Preferences>(
  () => getPreferences(),
);
export { preferences };

interface PreferencesPatch {
  general?: Partial<GeneralPreferences>;
  ui?: Partial<UiPreferences>;
}

/// Apply a partial update to the persisted preferences. Merges per
/// section so the caller doesn't need to know about unrelated fields.
/// Throws if preferences haven't loaded yet — components should guard
/// with `preferences()` before offering a write surface.
export async function updatePreferences(patch: PreferencesPatch): Promise<void> {
  const current = preferences();
  if (!current) {
    throw new Error("preferences not loaded yet");
  }
  const next: Preferences = {
    ...current,
    general: { ...current.general, ...(patch.general ?? {}) },
    ui: { ...current.ui, ...(patch.ui ?? {}) },
  };
  const saved = await ipcSetPreferences(next);
  mutatePreferencesResource(saved);
}

/// Wipe persisted preferences and reload defaults. Used by the
/// Preferences window's "Reset to defaults" affordance.
export async function resetPreferences(): Promise<void> {
  const fresh = await ipcResetPreferences();
  mutatePreferencesResource(fresh);
}
