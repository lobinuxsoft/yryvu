// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, createSignal, useContext } from "solid-js";

import {
  abortMerge,
  checkoutBranch,
  createBranch,
  deleteLocalBranch,
  deleteRemoteBranch,
  fetchPrune,
  isWorkingTreeDirty,
  mergeBranch,
  pull,
  push,
  rebaseCurrentOnto,
  renameBranch,
  resetToCommit,
  setUpstream,
  stashApply,
  stashDrop,
  stashPopAt,
  stashPush,
  type BranchInfo,
  type MergeStrategy,
  type RefTag,
  type ResetMode,
  type StashInfo,
  type SubmoduleInfo,
  submoduleAdd,
  submoduleInit,
  submoduleRemove,
  submoduleUpdate,
  type TagInfo,
  type WorktreeInfo,
  worktreeLock,
  worktreeRemove,
  worktreeUnlock,
} from "./ipc";
import {
  ALL_SECTION_KEYS,
  ALWAYS_VISIBLE_SECTION_KEYS,
  hiddenRefs,
  hiddenSections,
  maximizeSection,
  refreshBranches,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
  setHiddenRef,
  setInspectorMode,
  setRepoPath,
  setSelection,
  toggleSectionHidden,
  type SectionKey,
} from "./state";
import { openRepoInAnotherTab } from "./tabs/ops";
import type { ContextMenuItem } from "./components/ContextMenu";
import { parseRemoteBranchName } from "./components/LeftSidebar/helpers";
import type { DialogState, MenuState } from "./components/LeftSidebar/types";
import { notify } from "./components/Notifications";

export interface BranchOpsDeps {
  refresh: () => void;
}

export function createBranchOps(deps: BranchOpsDeps) {
  /// Live accessors the section context menu reads to compute Hide-all
  /// / Show-all enablement. Wired by the LeftSidebar in onMount via
  /// `setBranchSource` / `setTagSource` — the resources live there and
  /// we'd lose reactivity if AppShell tried to thread them through
  /// props ahead of mount. While unset (e.g. in unit tests) the menu
  /// silently drops the Hide-all / Show-all group.
  let branchSource: (() => BranchInfo[]) | undefined;
  let tagSource: (() => TagInfo[]) | undefined;
  function setBranchSource(fn: () => BranchInfo[]): void {
    branchSource = fn;
  }
  function setTagSource(fn: () => TagInfo[]): void {
    tagSource = fn;
  }
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [dialog, setDialog] = createSignal<DialogState>(null);
  const [dialogError, setDialogError] = createSignal<string | null>(null);
  const [dialogNameInput, setDialogNameInput] = createSignal("");
  /// Secondary text input shared by multi-field dialogs (currently only
  /// the Add Submodule dialog: name = URL, path = target dir). Kept on
  /// the ops surface so dialog components stay stateless wrappers.
  const [dialogPathInput, setDialogPathInput] = createSignal("");
  const [mergeStrategy, setMergeStrategy] =
    createSignal<MergeStrategy>("fast-forward-or-merge");
  const [refreshingRemote, setRefreshingRemote] = createSignal(false);

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
    setDialogPathInput("");
  }

  function openCreateDialog(from?: string) {
    setDialogError(null);
    setDialogNameInput("");
    setDialog({ kind: "create", from });
  }

  function openRenameDialog(oldName: string) {
    setDialogError(null);
    setDialogNameInput(oldName);
    setDialog({ kind: "rename", oldName });
  }

  function openDeleteDialog(name: string) {
    setDialogError(null);
    setDialog({ kind: "delete", name });
  }

  function openMergePickDialog(source: string) {
    setDialogError(null);
    setMergeStrategy("fast-forward-or-merge");
    setDialog({ kind: "merge-pick", source });
  }

  function openDeleteRemoteDialog(remote: string, name: string) {
    setDialogError(null);
    setDialog({ kind: "delete-remote", remote, name });
  }

  function openSubmoduleAddDialog() {
    setDialogError(null);
    setDialogNameInput("");
    setDialogPathInput("");
    setDialog({ kind: "submodule-add" });
  }

  function openSubmoduleRemoveDialog(name: string, path: string) {
    setDialogError(null);
    setDialog({ kind: "submodule-remove", name, path });
  }

  function openSetUpstreamDialog(branchName: string, currentUpstream: string | null) {
    setDialogError(null);
    setDialogNameInput(currentUpstream ?? "");
    setDialog({ kind: "set-upstream", branchName, currentUpstream });
  }

  async function tryCheckout(target: string) {
    const path = repoPath();
    if (!path) return;
    try {
      const dirty = await isWorkingTreeDirty(path);
      if (dirty) {
        setDialogError(null);
        setDialog({ kind: "checkout-dirty", target });
        return;
      }
      await doCheckout(target);
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function doCheckout(target: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await checkoutBranch(path, target);
      closeDialog();
      deps.refresh();
      refreshWorkingTree();
      notify.success("Checked out", { message: target });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Checkout failed", { message: String(err) });
    }
  }

  async function stashAndCheckout(target: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await stashPush(path, `chaja: auto-stash before checkout to ${target}`);
      await checkoutBranch(path, target);
      closeDialog();
      deps.refresh();
      refreshWorkingTree();
      notify.success("Checked out", { message: `Auto-stashed → ${target}` });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Checkout failed", { message: String(err) });
    }
  }

  async function submitMerge() {
    const state = dialog();
    if (state?.kind !== "merge-pick") return;
    const path = repoPath();
    if (!path) return;
    try {
      const result = await mergeBranch(path, state.source, mergeStrategy());
      setDialog({ kind: "merge-result", result });
      deps.refresh();
      refreshWorkingTree();
      switch (result.kind) {
        case "already-up-to-date":
          notify.success("Merge: already up to date", { message: state.source });
          break;
        case "fast-forward":
          notify.success("Fast-forward merge", {
            message: `${state.source} → ${result.new_head.slice(0, 7)}`,
          });
          break;
        case "merged":
          notify.success("Merge commit", {
            message: `${state.source} → ${result.new_head.slice(0, 7)}`,
          });
          break;
        case "conflict":
          notify.error("Merge conflicts", {
            message: result.paths.join(", "),
          });
          break;
      }
    } catch (err) {
      setDialogError(String(err));
      notify.error("Merge failed", { message: String(err) });
    }
  }

  async function submitDeleteRemote() {
    const state = dialog();
    if (state?.kind !== "delete-remote") return;
    const path = repoPath();
    if (!path) return;
    try {
      await deleteRemoteBranch(path, state.remote, state.name);
      closeDialog();
      deps.refresh();
      notify.success("Remote branch deleted", {
        message: `${state.remote}/${state.name}`,
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Delete remote branch failed", { message: String(err) });
    }
  }

  async function doRebaseCurrentOnto(target: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await rebaseCurrentOnto(path, target);
      // Rebase rewrites HEAD's history with new SHAs — graph must
      // restream so the new linear chain replaces the old one.
      refreshGraph();
      deps.refresh();
      refreshWorkingTree();
      notify.success("Rebased", { message: `onto ${target}` });
    } catch (err) {
      notify.error("Rebase failed", { message: String(err) });
    }
  }

  async function doPullCurrent() {
    const path = repoPath();
    if (!path) return;
    try {
      const result = await pull(path, mergeStrategy());
      // Pull may FF HEAD or write a merge commit; either way the graph
      // gains rows and HEAD pill jumps.
      refreshGraph();
      deps.refresh();
      refreshWorkingTree();
      if (result.kind === "conflict") {
        setDialog({ kind: "merge-result", result });
      } else {
        notify.success("Pulled");
      }
    } catch (err) {
      notify.error("Pull failed", { message: String(err) });
    }
  }

  async function doPushCurrent() {
    const path = repoPath();
    if (!path) return;
    try {
      await push(path);
      // Push doesn't move HEAD, but the remote pill catches up to it;
      // refreshGraph so the remote-tracking ref renders at the new tip.
      refreshGraph();
      deps.refresh();
      notify.success("Pushed");
    } catch (err) {
      notify.error("Push failed", { message: String(err) });
    }
  }

  async function doResetTo(sha: string, mode: ResetMode) {
    const path = repoPath();
    if (!path) return;
    try {
      await resetToCommit(path, sha, mode);
      // Reset moves HEAD (and pops commits) — graph must restream so
      // the HEAD pill lands on the target sha and the dropped commits
      // disappear (or stay, if any branch still tips them).
      refreshGraph();
      deps.refresh();
      refreshWorkingTree();
      notify.success("Reset HEAD", { message: `${mode} → ${sha.slice(0, 7)}` });
    } catch (err) {
      notify.error("Reset failed", { message: String(err) });
    }
  }

  async function submitSetUpstream() {
    const state = dialog();
    if (state?.kind !== "set-upstream") return;
    const path = repoPath();
    if (!path) return;
    const next = dialogNameInput().trim();
    const upstream = next.length > 0 ? next : null;
    try {
      await setUpstream(path, state.branchName, upstream);
      closeDialog();
      deps.refresh();
      notify.success("Upstream updated", {
        message: upstream ?? "(cleared)",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Set upstream failed", { message: String(err) });
    }
  }

  async function submitSubmoduleRemove() {
    const state = dialog();
    if (state?.kind !== "submodule-remove") return;
    const path = repoPath();
    if (!path) return;
    try {
      await submoduleRemove(path, state.name);
      closeDialog();
      deps.refresh();
      refreshWorkingTree();
      notify.success("Submodule removed", { message: state.path });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Remove submodule failed", { message: String(err) });
    }
  }

  async function submitSubmoduleAdd() {
    const state = dialog();
    if (state?.kind !== "submodule-add") return;
    const path = repoPath();
    const url = dialogNameInput().trim();
    const target = dialogPathInput().trim();
    if (!path || !url || !target) return;
    try {
      await submoduleAdd(path, url, target);
      closeDialog();
      deps.refresh();
      refreshWorkingTree();
      notify.success("Submodule added", { message: target });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Add submodule failed", { message: String(err) });
    }
  }

  async function doAbortMerge() {
    const path = repoPath();
    if (!path) return;
    try {
      await abortMerge(path);
      closeDialog();
      deps.refresh();
      refreshWorkingTree();
      notify.success("Merge aborted");
    } catch (err) {
      setDialogError(String(err));
      notify.error("Abort merge failed", { message: String(err) });
    }
  }

  async function submitCreate() {
    const state = dialog();
    if (state?.kind !== "create") return;
    const path = repoPath();
    const name = dialogNameInput().trim();
    if (!path || !name) return;
    try {
      await createBranch(path, name, state.from);
      closeDialog();
      deps.refresh();
      notify.success("Branch created", { message: name });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Create branch failed", { message: String(err) });
    }
  }

  async function submitRename() {
    const state = dialog();
    if (state?.kind !== "rename") return;
    const path = repoPath();
    const newName = dialogNameInput().trim();
    if (!path || !newName || newName === state.oldName) {
      closeDialog();
      return;
    }
    try {
      await renameBranch(path, state.oldName, newName);
      closeDialog();
      deps.refresh();
      notify.success("Branch renamed", {
        message: `${state.oldName} → ${newName}`,
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Rename branch failed", { message: String(err) });
    }
  }

  async function submitDelete(force: boolean) {
    const state = dialog();
    if (state?.kind !== "delete") return;
    const path = repoPath();
    if (!path) return;
    try {
      await deleteLocalBranch(path, state.name, force);
      closeDialog();
      deps.refresh();
      notify.success("Branch deleted", {
        message: force ? `${state.name} (forced)` : state.name,
      });
    } catch (err) {
      const msg = String(err);
      if (!force && msg.includes("not fully merged")) {
        // Keep the dialog open so the user can confirm a force-delete.
        // Don't toast yet — the dialog itself surfaces the next step.
        setDialog({ kind: "delete", name: state.name, unmerged: true });
        setDialogError(null);
        return;
      }
      setDialogError(msg);
      notify.error("Delete branch failed", { message: msg });
    }
  }

  async function refreshRemote() {
    const path = repoPath();
    if (!path || refreshingRemote()) return;
    setRefreshingRemote(true);
    try {
      await fetchPrune(path);
      deps.refresh();
      notify.success("Fetched all remotes");
    } catch (err) {
      const msg = String(err);
      setDialogError(`Refresh failed: ${msg}`);
      notify.error("Fetch failed", { message: msg });
    } finally {
      setRefreshingRemote(false);
    }
  }

  /**
   * Right-click menu for a local branch row in the LeftPanel
   * (#221). Mirrors GK's `popupRefMenu` → `getRefGroupItems` shape
   * (bundle:232395), trimmed to the surfaces chajá actually wraps:
   *
   *   Checkout / Merge into current / Rebase current onto    — operate
   *                                                            on the
   *                                                            right-clicked
   *                                                            ref.
   *   Pull / Push / Set Upstream                             — operate
   *                                                            on HEAD;
   *                                                            disabled
   *                                                            when the
   *                                                            right-clicked
   *                                                            row isn't
   *                                                            HEAD so the
   *                                                            user has a
   *                                                            single
   *                                                            unambiguous
   *                                                            target.
   *   Push and start PR                                      — disabled,
   *                                                            blocked by
   *                                                            #46 (OAuth).
   *   Create branch here / Reset HEAD here (Soft|Mixed|Hard) — Reset 3-way
   *                                                            flattens GK's
   *                                                            submenu since
   *                                                            chajá's
   *                                                            ContextMenu
   *                                                            doesn't yet
   *                                                            wrap submenus.
   *   Rename / Delete                                        — already
   *                                                            wired before
   *                                                            this PR.
   *   Compare against working copy / Copy branch name        — UI ops; no
   *                                                            backend call.
   *
   * "Pin to left" lives in #233 — it needs graph-lane rendering work
   * beyond a menu item.
   */
  function openBranchContextMenu(e: MouseEvent, b: BranchInfo) {
    e.preventDefault();
    const isHead = b.is_head;
    const hasUpstream = !!b.upstream;
    const headOnly = !isHead;
    const items: ContextMenuItem[] = [
      {
        label: "Checkout",
        disabled: isHead,
        onSelect: () => void tryCheckout(b.name),
      },
      {
        label: `Merge '${b.name}' into current`,
        disabled: isHead,
        onSelect: () => openMergePickDialog(b.name),
      },
      {
        label: `Rebase current onto '${b.name}'`,
        disabled: isHead,
        onSelect: () => void doRebaseCurrentOnto(b.name),
      },
      { type: "separator" },
      {
        label: "Pull",
        disabled: headOnly || !hasUpstream,
        title: headOnly
          ? "Checkout this branch to pull"
          : !hasUpstream
            ? "Branch has no upstream — set one first"
            : undefined,
        onSelect: () => void doPullCurrent(),
      },
      {
        label: "Push",
        disabled: headOnly,
        title: headOnly ? "Checkout this branch to push" : undefined,
        onSelect: () => void doPushCurrent(),
      },
      {
        label: "Set Upstream…",
        disabled: headOnly,
        title: headOnly ? "Checkout this branch to set its upstream" : undefined,
        onSelect: () => openSetUpstreamDialog(b.name, b.upstream),
      },
      {
        label: "Push and start PR",
        disabled: true,
        title: "Requires OAuth (#46)",
        onSelect: () => {},
      },
      { type: "separator" },
      {
        label: "Create branch here",
        onSelect: () => openCreateDialog(b.tip_sha),
      },
      {
        label: `Reset HEAD to '${b.name}' (Soft)`,
        disabled: isHead,
        onSelect: () => void doResetTo(b.tip_sha, "soft"),
      },
      {
        label: `Reset HEAD to '${b.name}' (Mixed)`,
        disabled: isHead,
        onSelect: () => void doResetTo(b.tip_sha, "mixed"),
      },
      {
        label: `Reset HEAD to '${b.name}' (Hard)`,
        danger: true,
        disabled: isHead,
        onSelect: () => void doResetTo(b.tip_sha, "hard"),
      },
      { type: "separator" },
      {
        label: `Rename '${b.name}'…`,
        onSelect: () => openRenameDialog(b.name),
      },
      {
        label: `Delete '${b.name}'…`,
        danger: true,
        disabled: isHead,
        onSelect: () => openDeleteDialog(b.name),
      },
      { type: "separator" },
      {
        label: "Compare against working copy",
        onSelect: () => {
          setSelection([b.tip_sha], true);
          setInspectorMode("details");
        },
      },
      {
        label: "Copy branch name",
        onSelect: () => {
          void navigator.clipboard.writeText(b.name);
          notify.info("Branch name copied", { message: b.name });
        },
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  /**
   * Right-click menu for a section header in the LeftPanel (#220).
   * Builds the three-group GK shape from audit doc 10:
   *
   *   1. Hide all / Show all   — only LOCAL / REMOTE / TAGS surfaces
   *      have a ref-level "hidden" concept that maps cleanly. STASHES
   *      gets it in a follow-up (chajá lacks a hideAllStashes API).
   *   2. Maximize this section — collapses every other section, expands
   *      this one full-height. Persisted across restarts.
   *   3. Visibility checkboxes — every section keyed in ALL_SECTION_KEYS,
   *      with a ✓ prefix when visible. LOCAL is always-on (audit doc 00),
   *      so its row is disabled.
   */
  function openSectionContextMenu(e: MouseEvent, key: SectionKey) {
    e.preventDefault();

    const items: ContextMenuItem[] = [];

    // ---- Group 1: Hide all / Show all (LOCAL / REMOTE / TAGS) -----
    if (key === "LOCAL" && branchSource) {
      const locals = branchSource().filter((b) => b.kind === "local");
      const localKeys = locals.map((b) =>
        refKey({ kind: "Branch", name: b.name }),
      );
      const someShown = localKeys.some((k) => !hiddenRefs().has(k));
      const someHidden = localKeys.some((k) => hiddenRefs().has(k));
      items.push({
        label: "Hide all local branches",
        disabled: !someShown,
        onSelect: () => localKeys.forEach((k) => setHiddenRef(k, true)),
      });
      items.push({
        label: "Show all local branches",
        disabled: !someHidden,
        onSelect: () => localKeys.forEach((k) => setHiddenRef(k, false)),
      });
      items.push({ type: "separator" });
    } else if (key === "REMOTE" && branchSource) {
      const remoteKeys = branchSource()
        .filter((b) => b.kind === "remote")
        .map((b) => refKey({ kind: "RemoteBranch", name: b.name }));
      const someShown = remoteKeys.some((k) => !hiddenRefs().has(k));
      const someHidden = remoteKeys.some((k) => hiddenRefs().has(k));
      items.push({
        label: "Hide all remote branches",
        disabled: !someShown,
        onSelect: () => remoteKeys.forEach((k) => setHiddenRef(k, true)),
      });
      items.push({
        label: "Show all remote branches",
        disabled: !someHidden,
        onSelect: () => remoteKeys.forEach((k) => setHiddenRef(k, false)),
      });
      items.push({ type: "separator" });
    } else if (key === "TAGS" && tagSource) {
      const tagKeys = tagSource().map((t) =>
        refKey({ kind: "Tag", name: t.name }),
      );
      const someShown = tagKeys.some((k) => !hiddenRefs().has(k));
      const someHidden = tagKeys.some((k) => hiddenRefs().has(k));
      items.push({
        label: "Hide all tags",
        disabled: !someShown,
        onSelect: () => tagKeys.forEach((k) => setHiddenRef(k, true)),
      });
      items.push({
        label: "Show all tags",
        disabled: !someHidden,
        onSelect: () => tagKeys.forEach((k) => setHiddenRef(k, false)),
      });
      items.push({ type: "separator" });
    }

    // ---- Group 2: Maximize -----------------------------------------
    items.push({
      label: "Maximize this section",
      onSelect: () => maximizeSection(key),
    });
    items.push({ type: "separator" });

    // ---- Group 3: Per-section visibility ---------------------------
    // Use a leading ✓ prefix for visible sections, ' ' (em space) for
    // hidden — keeps the alignment readable in mono-fallback fonts and
    // doesn't depend on a checkbox menu type the renderer doesn't have.
    for (const sk of ALL_SECTION_KEYS) {
      const isVisible = !hiddenSections().has(sk);
      const isAlwaysOn = ALWAYS_VISIBLE_SECTION_KEYS.includes(sk);
      const prefix = isVisible ? "✓ " : "  ";
      items.push({
        label: `${prefix}${sectionLabel(sk)}`,
        disabled: isAlwaysOn,
        onSelect: () => toggleSectionHidden(sk),
      });
    }

    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  /**
   * Right-click menu for a submodule row in the LeftPanel SUBMODULES
   * section (#226). Shape mirrors GitKraken's `popupSubmoduleMenu`
   * (audit doc 10):
   *
   *   Initialize             — submodule update --init
   *   Update                 — submodule update (already initialized)
   *   Reset                  — disabled. Force-checkout pinned-SHA
   *                            requires more libgit2 surface than gix
   *                            exposes today.
   *   Commit                 — disabled. Open-the-submodule-as-its-own
   *                            tab is the natural path; commit flow
   *                            already lives there.
   *   ─────
   *   Open in tab            — setRepoPath + openRepoInAnotherTab.
   *   Open in file manager   — Tauri opener `open_path`.
   *   Open in terminal       — disabled. Cross-platform terminal
   *                            launcher needs config (xdg-terminal-exec
   *                            on Linux, Terminal.app on macOS, …).
   *   ─────
   *   Copy path              — clipboard.writeText with absolute path.
   */
  function openSubmoduleContextMenu(e: MouseEvent, info: SubmoduleInfo) {
    e.preventDefault();
    const parent = repoPath();
    if (!parent) return;
    const absPath = `${parent}/${info.path}`;
    const isClickable = info.is_initialized && !info.is_deleted;

    const items: ContextMenuItem[] = [
      {
        label: "Initialize",
        disabled: info.is_initialized,
        onSelect: async () => {
          try {
            await submoduleInit(parent, info.name);
            refreshBranches();
            refreshWorkingTree();
            notify.success("Submodule initialized", { message: info.name });
          } catch (err) {
            notify.error("Initialize failed", { message: String(err) });
          }
        },
      },
      {
        label: "Update",
        disabled: !info.is_initialized,
        onSelect: async () => {
          try {
            await submoduleUpdate(parent, info.name);
            refreshBranches();
            refreshWorkingTree();
            notify.success("Submodule updated", { message: info.name });
          } catch (err) {
            notify.error("Update failed", { message: String(err) });
          }
        },
      },
      {
        label: "Reset",
        disabled: true,
        // Force-checkout to parent-pinned needs more libgit2 surface
        // than chajá wraps today. Tracked separately if the user
        // wants this — git CLI gives them an escape hatch.
        onSelect: () => {},
      },
      {
        label: "Commit",
        disabled: true,
        // The natural path is "Open in tab" + use the commit panel
        // there. Keep the menu item so users discover the option,
        // but route them through the inner-repo flow instead of
        // surfacing a half-baked nested commit dialog here.
        onSelect: () => {},
      },
      { type: "separator" },
      {
        label: "Open in tab",
        disabled: !isClickable,
        onSelect: () => {
          setRepoPath(absPath);
          void openRepoInAnotherTab(absPath);
        },
      },
      {
        label: "Open in file manager",
        disabled: !isClickable,
        onSelect: async () => {
          try {
            const { openPath } = await import("@tauri-apps/plugin-opener");
            await openPath(absPath);
          } catch (err) {
            notify.error("Open in file manager failed", {
              message: String(err),
            });
          }
        },
      },
      {
        label: "Open in terminal",
        disabled: true,
        // Cross-platform terminal launching requires per-OS plumbing
        // (xdg-terminal-exec on Linux, `open -a Terminal` on macOS,
        // wt.exe / cmd on Windows) plus a preference for which one to
        // use. Defer to a focused follow-up.
        onSelect: () => {},
      },
      { type: "separator" },
      {
        label: "Copy path",
        onSelect: () => {
          void navigator.clipboard.writeText(absPath);
          notify.info("Path copied", { message: absPath });
        },
      },
      { type: "separator" },
      {
        label: "Remove submodule…",
        onSelect: () => openSubmoduleRemoveDialog(info.name, info.path),
      },
    ];

    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  /**
   * Right-click menu for a worktree row in the LeftPanel WORKTREES
   * section (#225). Shape mirrors GitKraken's `popupWorktreeMenu`
   * (audit doc 10):
   *
   *   Switch to worktree     — same as left-click on the row.
   *   Create branch here     — open the create-branch dialog seeded
   *                            with the worktree's HEAD sha.
   *   ─────
   *   Lock / Unlock          — toggles based on current locked state.
   *                            Hidden for the main worktree (can't lock).
   *   Move…                  — disabled (libgit2 doesn't expose it).
   *   ─────
   *   Remove                 — danger. Hidden for the main worktree.
   */
  function openWorktreeContextMenu(e: MouseEvent, info: WorktreeInfo) {
    e.preventDefault();
    const path = repoPath();
    if (!path) return;

    const items: ContextMenuItem[] = [
      {
        label: "Switch to worktree",
        disabled: !!info.locked && info.locked !== "",
        onSelect: () => {
          setRepoPath(info.workdir);
          void openRepoInAnotherTab(info.workdir, !info.is_main);
        },
      },
    ];
    if (info.head) {
      items.push({
        label: "Create branch here",
        onSelect: () => openCreateDialog(info.head ?? undefined),
      });
    }

    if (!info.is_main) {
      items.push({ type: "separator" });
      const isLocked = !!info.locked;
      items.push({
        label: isLocked ? "Unlock" : "Lock…",
        onSelect: async () => {
          try {
            if (isLocked) {
              await worktreeUnlock(path, info.workdir);
              notify.success("Worktree unlocked", {
                message: info.workdir,
              });
            } else {
              // chajá doesn't ship a Lock-with-reason dialog yet; a
              // null reason matches `git worktree lock` defaults.
              await worktreeLock(path, info.workdir, null);
              notify.success("Worktree locked", { message: info.workdir });
            }
            refreshBranches();
          } catch (err) {
            notify.error(isLocked ? "Unlock failed" : "Lock failed", {
              message: String(err),
            });
          }
        },
      });
      items.push({
        label: "Move…",
        disabled: true,
        // libgit2 doesn't expose `git worktree move`. Hand-rolling the
        // rename + gitdir rewrite is out of scope here — surfaces as
        // disabled with a tooltip pointing the user at the gap.
        onSelect: () => {},
      });
      items.push({ type: "separator" });
      items.push({
        label: "Remove",
        danger: true,
        onSelect: async () => {
          try {
            await worktreeRemove(path, info.workdir);
            refreshBranches();
            refreshWorkingTree();
            notify.info("Worktree removed", { message: info.workdir });
          } catch (err) {
            notify.error("Remove failed", { message: String(err) });
          }
        },
      });
    }

    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  /**
   * Right-click menu for a stash row in the LeftPanel STASHES section.
   * Shape mirrors GitKraken's `popupStashMenu` (audit doc 10): Apply,
   * Pop, Drop, Amend message. Amend stays disabled until the rewrite-
   * stash flow lands in a follow-up.
   *
   * `index` is the LIFO position from `listStashes` (0 = top). Apply
   * keeps the entry in the queue; Pop applies + removes; Drop removes
   * without applying. Drop records the dropped sha in the undo log so
   * the stash survives in the objects DB until GC.
   */
  function openStashContextMenu(e: MouseEvent, info: StashInfo, index: number) {
    e.preventDefault();
    const path = repoPath();
    if (!path) return;

    const label = info.message.split("\n")[0] || `stash@{${index}}`;
    const items: ContextMenuItem[] = [
      {
        label: "Apply",
        onSelect: async () => {
          try {
            await stashApply(path, index);
            refreshWorkingTree();
            notify.success("Stash applied", { message: label });
          } catch (err) {
            notify.error("Apply failed", { message: String(err) });
          }
        },
      },
      {
        label: "Pop",
        onSelect: async () => {
          try {
            await stashPopAt(path, index);
            refreshWorkingTree();
            notify.success("Stash popped", { message: label });
          } catch (err) {
            notify.error("Pop failed", { message: String(err) });
          }
        },
      },
      {
        label: "Drop",
        danger: true,
        onSelect: async () => {
          try {
            await stashDrop(path, index);
            refreshWorkingTree();
            // Note: stash drop is NOT undoable via the chajá undo log
            // (crates/chaja-bridge/src/repo/undo.rs:22 — re-stashing
            // needs a heavier snapshot than libgit2 exposes). The sha
            // does live in the objects DB until git GC (~90 days), so
            // a determined user can `git stash apply <sha>` from a
            // terminal — but from chajá's UI it's gone for good.
            notify.info("Stash dropped", { message: label });
          } catch (err) {
            notify.error("Drop failed", { message: String(err) });
          }
        },
      },
      { type: "separator" },
      {
        label: "Amend message…",
        disabled: true,
        // TODO: wire stash message rewrite — needs a small backend op
        // that reads the stash commit, re-creates with the new message,
        // and updates refs/stash. Tracked as part of the #224 follow-up
        // (deferred per the issue body).
        onSelect: () => {},
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  function openRemoteContextMenu(e: MouseEvent, b: BranchInfo) {
    e.preventDefault();
    const parsed = parseRemoteBranchName(b.name);
    const items: ContextMenuItem[] = [
      {
        label: `Merge '${b.name}' into current`,
        onSelect: () => openMergePickDialog(b.name),
      },
      { type: "separator" },
      {
        label: "Create branch here",
        onSelect: () => openCreateDialog(b.tip_sha),
      },
      {
        label: `Delete remote '${b.name}'…`,
        danger: true,
        disabled: !parsed,
        onSelect: () =>
          parsed && openDeleteRemoteDialog(parsed.remote, parsed.name),
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  /**
   * Right-click menu for a ref pill in the BRANCH/TAG column. Items shape
   * follows the GitKraken bundle's `RefContextMenu` (validated 2026-04-25):
   * `RefCheckout`, `RenameRef`, `RefDelete`, `RefPin` (chajá-internal still),
   * `RefHide`. Ref-kind drives availability — tags don't checkout, remote
   * branches don't rename in-place, etc.
   *
   * The pill's commit sha lets us reuse the same `tryCheckout` /
   * `openCreateDialog` flow as the sidebar — no new ops surface needed.
   */
  function openRefContextMenu(e: MouseEvent, tag: RefTag, sha: string) {
    e.preventDefault();
    const items: ContextMenuItem[] = [];
    if (tag.kind === "Branch") {
      items.push({
        label: `Checkout '${tag.name}'`,
        onSelect: () => void tryCheckout(tag.name),
      });
      items.push({
        label: `Merge '${tag.name}' into current`,
        onSelect: () => openMergePickDialog(tag.name),
      });
      items.push({ type: "separator" });
      items.push({
        label: "Create branch here",
        onSelect: () => openCreateDialog(sha),
      });
      items.push({
        label: `Rename '${tag.name}'…`,
        onSelect: () => openRenameDialog(tag.name),
      });
      items.push({
        label: `Delete '${tag.name}'…`,
        danger: true,
        onSelect: () => openDeleteDialog(tag.name),
      });
    } else if (tag.kind === "RemoteBranch") {
      const parsed = parseRemoteBranchName(tag.name);
      items.push({
        label: `Merge '${tag.name}' into current`,
        onSelect: () => openMergePickDialog(tag.name),
      });
      items.push({ type: "separator" });
      items.push({
        label: "Create branch here",
        onSelect: () => openCreateDialog(sha),
      });
      items.push({
        label: `Delete remote '${tag.name}'…`,
        danger: true,
        disabled: !parsed,
        onSelect: () =>
          parsed && openDeleteRemoteDialog(parsed.remote, parsed.name),
      });
    } else if (tag.kind === "Tag") {
      items.push({
        label: "Create branch here",
        onSelect: () => openCreateDialog(sha),
      });
    }
    // Hide is offered for every non-active ref (the bundle gates it on
    // `enableShowHideRefsOptions && !hasActive`; the per-pill flag covers the
    // second half — the first is a global setting we don't expose yet).
    if (tag.kind !== "Head") {
      if (items.length > 0) items.push({ type: "separator" });
      items.push({
        label: `Hide '${tag.name}'`,
        onSelect: () => setHiddenRef(refKey(tag), true),
      });
    }
    if (items.length === 0) return;
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  return {
    // state
    menu,
    setMenu,
    dialog,
    dialogError,
    dialogNameInput,
    setDialogNameInput,
    dialogPathInput,
    setDialogPathInput,
    mergeStrategy,
    setMergeStrategy,
    refreshingRemote,
    // dialog openers / closers
    openCreateDialog,
    openRenameDialog,
    openDeleteDialog,
    openMergePickDialog,
    openDeleteRemoteDialog,
    openSubmoduleAddDialog,
    openSubmoduleRemoveDialog,
    openSetUpstreamDialog,
    closeDialog,
    // context menu
    openBranchContextMenu,
    openRemoteContextMenu,
    openRefContextMenu,
    openSectionContextMenu,
    openStashContextMenu,
    openSubmoduleContextMenu,
    openWorktreeContextMenu,
    setBranchSource,
    setTagSource,
    // async operations
    tryCheckout,
    stashAndCheckout,
    submitCreate,
    submitRename,
    submitDelete,
    submitMerge,
    submitDeleteRemote,
    submitSubmoduleAdd,
    submitSubmoduleRemove,
    submitSetUpstream,
    doAbortMerge,
    refreshRemote,
  };
}

export type BranchOps = ReturnType<typeof createBranchOps>;

/**
 * Stable key used to track hidden refs across reloads. Encodes both kind
 * and name because tags and branches share namespaces and the Hide action
 * targets a specific (kind, name) pair from the right-click menu.
 */
export function refKey(tag: { kind: RefTag["kind"]; name: string }): string {
  return `${tag.kind}/${tag.name}`;
}

/**
 * Display label for a section key in the visibility-checkbox group. Mirrors
 * GK's `getLeftPanelSectionTranslateString` (audit doc 10) — labels match
 * the section header text the user sees in the sidebar so the menu reads
 * unambiguously.
 */
function sectionLabel(key: SectionKey): string {
  switch (key) {
    case "LOCAL":
      return "Local Branches";
    case "REMOTE":
      return "Remote Branches";
    case "WORKTREES":
      return "Worktrees";
    case "STASHES":
      return "Stashes";
    case "PULL_REQUESTS":
      return "Pull Requests";
    case "ISSUES":
      return "Issues";
    case "TAGS":
      return "Tags";
    case "SUBMODULES":
      return "Submodules";
  }
}

/**
 * Solid context wiring for the lifted `useBranchOps`. AppShell instantiates
 * exactly one `createBranchOps` call and exposes it via the provider; both
 * LeftSidebar and CommitGraph (ref pills) consume the same instance so the
 * dialogs / menu / refresh nonces stay coordinated.
 */
const BranchOpsContext = createContext<BranchOps>();

export function BranchOpsProvider(props: {
  ops: BranchOps;
  children: import("solid-js").JSX.Element;
}) {
  return (
    <BranchOpsContext.Provider value={props.ops}>
      {props.children}
    </BranchOpsContext.Provider>
  );
}

export function useBranchOps(): BranchOps {
  const ctx = useContext(BranchOpsContext);
  if (!ctx) {
    throw new Error("useBranchOps must be called inside <BranchOpsProvider>");
  }
  return ctx;
}
