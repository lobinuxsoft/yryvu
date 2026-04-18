// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createResource,
  createSignal,
  For,
  type JSX,
  Show,
} from "solid-js";

import {
  abortMerge,
  checkoutBranch,
  createBranch,
  deleteLocalBranch,
  deleteRemoteBranch,
  fetchPrune,
  getRepoState,
  isWorkingTreeDirty,
  listBranches,
  mergeBranch,
  renameBranch,
  stashPush,
  type BranchInfo,
  type MergeResult,
  type MergeStrategy,
  type RepoStateInfo,
} from "../../ipc";
import { repoPath, setShowLeftPanel, showLeftPanel } from "../../state";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { Dialog } from "../Dialog";
import {
  IconArchive,
  IconBranch,
  IconCircleDot,
  IconCloud,
  IconPullRequest,
  IconRefresh,
  IconTag,
  IconUsers,
} from "../Icons";

interface SidebarSectionProps {
  title: string;
  icon: JSX.Element;
  count?: number;
  initialExpanded?: boolean;
  addable?: boolean;
  onAdd?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: JSX.Element;
}

function SidebarSection(props: SidebarSectionProps) {
  const [expanded, setExpanded] = createSignal(props.initialExpanded ?? false);
  return (
    <div class="sidebar__section" data-expanded={expanded() ? "true" : "false"}>
      <button
        class="sidebar__section-header"
        type="button"
        title={props.title}
        onClick={() => setExpanded((v) => !v)}
      >
        <span class="sidebar__section-caret">›</span>
        <span class="sidebar__section-icon">{props.icon}</span>
        <span class="sidebar__section-title">{props.title}</span>
        <Show when={props.count !== undefined}>
          <span class="sidebar__section-count">{props.count}</span>
        </Show>
        <Show when={props.onRefresh}>
          <span
            class="sidebar__section-refresh"
            data-spinning={props.refreshing ? "true" : "false"}
            role="button"
            tabindex={0}
            aria-label={`Refresh ${props.title}`}
            title={`Refresh ${props.title}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!props.refreshing) props.onRefresh?.();
            }}
          >
            <IconRefresh />
          </span>
        </Show>
        <Show when={props.addable}>
          <span
            class="sidebar__section-add"
            role="button"
            tabindex={0}
            aria-label={`Add to ${props.title}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onAdd?.();
            }}
          >
            +
          </span>
        </Show>
      </button>
      <div class="sidebar__section-body">{props.children}</div>
    </div>
  );
}

type MenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
};

type DialogState =
  | { kind: "create"; from?: string }
  | { kind: "rename"; oldName: string }
  | { kind: "delete"; name: string; unmerged?: boolean }
  | { kind: "checkout-dirty"; target: string }
  | { kind: "merge-pick"; source: string }
  | { kind: "merge-result"; result: MergeResult }
  | { kind: "delete-remote"; remote: string; name: string }
  | null;

function parseRemoteBranchName(
  shortName: string,
): { remote: string; name: string } | null {
  const idx = shortName.indexOf("/");
  if (idx === -1) return null;
  return { remote: shortName.slice(0, idx), name: shortName.slice(idx + 1) };
}

export function LeftSidebar() {
  const [collapsed, setCollapsed] = createSignal(false);
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [dialog, setDialog] = createSignal<DialogState>(null);
  const [dialogError, setDialogError] = createSignal<string | null>(null);
  const [dialogNameInput, setDialogNameInput] = createSignal("");
  const [mergeStrategy, setMergeStrategy] =
    createSignal<MergeStrategy>("fast-forward-or-merge");
  const [refreshingRemote, setRefreshingRemote] = createSignal(false);

  const [tick, setTick] = createSignal(0);
  const refresh = () => setTick((t) => t + 1);

  async function refreshRemote() {
    const path = repoPath();
    if (!path || refreshingRemote()) return;
    setRefreshingRemote(true);
    try {
      await fetchPrune(path);
      refresh();
    } catch (err) {
      // Surface the error non-destructively via the dialog-error channel so the
      // user sees it without blocking the UI. Typical failure is auth-related.
      setDialogError(`Refresh failed: ${String(err)}`);
    } finally {
      setRefreshingRemote(false);
    }
  }

  const [branches] = createResource<BranchInfo[], [string, number]>(
    () => [repoPath() ?? "", tick()] as [string, number],
    async ([path]) => {
      if (!path) return [] as BranchInfo[];
      return await listBranches(path);
    },
    { initialValue: [] },
  );

  const [repoState] = createResource<RepoStateInfo, [string, number]>(
    () => [repoPath() ?? "", tick()] as [string, number],
    async ([path]) => {
      if (!path) return { kind: "clean", conflict_paths: [] };
      return await getRepoState(path);
    },
    { initialValue: { kind: "clean", conflict_paths: [] } },
  );

  const locals = () => (branches() ?? []).filter((b) => b.kind === "local");
  const remotes = () => (branches() ?? []).filter((b) => b.kind === "remote");

  function openBranchContextMenu(e: MouseEvent, b: BranchInfo) {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      {
        label: "Checkout",
        disabled: b.is_head,
        onSelect: () => void tryCheckout(b.name),
      },
      {
        label: `Merge '${b.name}' into current`,
        disabled: b.is_head,
        onSelect: () => openMergePickDialog(b.name),
      },
      { type: "separator" },
      {
        label: "Create branch here",
        onSelect: () => openCreateDialog(b.tip_sha),
      },
      {
        label: `Rename '${b.name}'…`,
        onSelect: () => openRenameDialog(b.name),
      },
      {
        label: `Delete '${b.name}'…`,
        danger: true,
        disabled: b.is_head,
        onSelect: () => openDeleteDialog(b.name),
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
  function closeDialog() {
    setDialog(null);
    setDialogError(null);
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
      refresh();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function stashAndCheckout(target: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await stashPush(path, `chaja: auto-stash before checkout to ${target}`);
      await checkoutBranch(path, target);
      closeDialog();
      refresh();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function submitMerge() {
    const state = dialog();
    if (state?.kind !== "merge-pick") return;
    const path = repoPath();
    if (!path) return;
    try {
      const result = await mergeBranch(path, state.source, mergeStrategy());
      if (result.kind === "conflict") {
        setDialog({ kind: "merge-result", result });
      } else {
        setDialog({ kind: "merge-result", result });
      }
      refresh();
    } catch (err) {
      setDialogError(String(err));
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
      refresh();
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function doAbortMerge() {
    const path = repoPath();
    if (!path) return;
    try {
      await abortMerge(path);
      closeDialog();
      refresh();
    } catch (err) {
      setDialogError(String(err));
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
      refresh();
    } catch (err) {
      setDialogError(String(err));
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
      refresh();
    } catch (err) {
      setDialogError(String(err));
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
      refresh();
    } catch (err) {
      const msg = String(err);
      if (!force && msg.includes("not fully merged")) {
        setDialog({ kind: "delete", name: state.name, unmerged: true });
        setDialogError(null);
        return;
      }
      setDialogError(msg);
    }
  }

  return (
    <aside class="sidebar" data-collapsed={collapsed() ? "true" : "false"}>
      <div class="sidebar__header">
        <button
          class="tabs__leading-btn"
          type="button"
          title={collapsed() ? "Expand sidebar" : "Collapse to icons"}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed() ? "›" : "‹"}
        </button>
        <span>Viewing</span>
        <span class="sidebar__item-badge">{branches()?.length ?? 0}</span>
      </div>

      <Show when={!collapsed()}>
        <div class="sidebar__filter">
          <input type="text" placeholder="Filter (Ctrl+Alt+F)" />
        </div>
      </Show>

      <Show
        when={
          !collapsed() &&
          repoState() &&
          repoState()!.kind !== "clean"
        }
      >
        <div class="sidebar__state-banner" data-kind={repoState()!.kind}>
          <div class="sidebar__state-banner__title">
            <span>⚠</span>
            <span>{stateBannerTitle(repoState()!.kind)}</span>
          </div>
          <Show when={repoState()!.conflict_paths.length > 0}>
            <div class="sidebar__state-banner__subtitle">
              Conflicted files ({repoState()!.conflict_paths.length}):
            </div>
            <ul class="sidebar__state-banner__paths">
              <For each={repoState()!.conflict_paths}>
                {(p) => <li>{p}</li>}
              </For>
            </ul>
          </Show>
          <div class="sidebar__state-banner__actions">
            <Show when={repoState()!.kind === "merge"}>
              <button
                class="dialog__btn dialog__btn--danger"
                type="button"
                onClick={() => void doAbortMerge()}
              >
                Abort merge
              </button>
            </Show>
            <Show when={repoState()!.kind !== "merge"}>
              <span class="sidebar__state-banner__hint">
                Abort support for this state is not implemented yet — resolve
                manually or via CLI.
              </span>
            </Show>
          </div>
        </div>
      </Show>

      <div class="sidebar__sections">
        <SidebarSection
          title="Local"
          icon={<IconBranch />}
          count={locals().length}
          initialExpanded
          addable
          onAdd={() => openCreateDialog()}
        >
          <Show
            when={repoPath()}
            fallback={
              <p class="sidebar__empty">Open a repo to list branches</p>
            }
          >
            <Show
              when={locals().length > 0}
              fallback={<p class="sidebar__empty">No local branches</p>}
            >
              <For each={locals()}>
                {(b) => (
                  <div
                    class="sidebar__branch-row"
                    data-active={b.is_head ? "true" : "false"}
                    title={
                      b.upstream
                        ? `tracks ${b.upstream} — double-click to checkout`
                        : "no upstream — double-click to checkout"
                    }
                    onContextMenu={(e) => openBranchContextMenu(e, b)}
                    onDblClick={() => {
                      if (!b.is_head) void tryCheckout(b.name);
                    }}
                  >
                    <span class="sidebar__branch-name">{b.name}</span>
                    <Show when={b.ahead > 0 || b.behind > 0}>
                      <span class="sidebar__branch-tracking">
                        <Show when={b.ahead > 0}>
                          <span data-dir="ahead">{b.ahead}↑</span>
                        </Show>
                        <Show when={b.behind > 0}>
                          <span data-dir="behind">{b.behind}↓</span>
                        </Show>
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </SidebarSection>

        <SidebarSection
          title="Remote"
          icon={<IconCloud />}
          count={remotes().length}
          onRefresh={() => void refreshRemote()}
          refreshing={refreshingRemote()}
        >
          <Show
            when={remotes().length > 0}
            fallback={<p class="sidebar__empty">No remote branches</p>}
          >
            <For each={remotes()}>
              {(b) => (
                <div
                  class="sidebar__branch-row"
                  onContextMenu={(e) => openRemoteContextMenu(e, b)}
                >
                  <span class="sidebar__branch-name">{b.name}</span>
                </div>
              )}
            </For>
          </Show>
        </SidebarSection>

        <SidebarSection title="Cloud Patches" icon={<IconArchive />} count={0}>
          <p class="sidebar__empty">—</p>
        </SidebarSection>
        <SidebarSection title="Pull Requests" icon={<IconPullRequest />} count={0} addable>
          <p class="sidebar__empty">—</p>
        </SidebarSection>
        <SidebarSection title="GitHub Issues" icon={<IconCircleDot />} count={0}>
          <p class="sidebar__empty">—</p>
        </SidebarSection>
        <SidebarSection title="Tags" icon={<IconTag />} count={0}>
          <p class="sidebar__empty">—</p>
        </SidebarSection>
        <SidebarSection title="Teams" icon={<IconUsers />} count={0}>
          <p class="sidebar__empty">—</p>
        </SidebarSection>
      </div>

      <Show when={menu()}>
        <ContextMenu
          x={menu()!.x}
          y={menu()!.y}
          items={menu()!.items}
          onClose={() => setMenu(null)}
        />
      </Show>

      <Dialog
        open={dialog()?.kind === "create"}
        title={
          dialog()?.kind === "create" && (dialog() as { from?: string }).from
            ? "Create branch from commit"
            : "Create branch"
        }
        onClose={closeDialog}
        footer={
          <>
            <button
              class="dialog__btn"
              type="button"
              data-dismiss
              onClick={closeDialog}
            >
              Cancel
            </button>
            <button
              class="dialog__btn dialog__btn--primary"
              type="button"
              disabled={!dialogNameInput().trim()}
              onClick={submitCreate}
            >
              Create
            </button>
          </>
        }
      >
        <div class="dialog__field">
          <label for="create-branch-name">Branch name</label>
          <input
            id="create-branch-name"
            type="text"
            value={dialogNameInput()}
            placeholder="my-new-branch"
            onInput={(e) => setDialogNameInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
            }}
          />
        </div>
        <Show when={dialog()?.kind === "create" && (dialog() as { from?: string }).from}>
          <p class="dialog__field" style={{ "margin-top": "8px", color: "var(--fg-2)", "font-size": "12px" }}>
            From: <code>{(dialog() as { from?: string }).from?.slice(0, 7)}</code>
          </p>
        </Show>
        <Show when={dialogError()}>
          <p class="dialog__error">{dialogError()}</p>
        </Show>
      </Dialog>

      <Dialog
        open={dialog()?.kind === "rename"}
        title="Rename branch"
        onClose={closeDialog}
        footer={
          <>
            <button
              class="dialog__btn"
              type="button"
              data-dismiss
              onClick={closeDialog}
            >
              Cancel
            </button>
            <button
              class="dialog__btn dialog__btn--primary"
              type="button"
              disabled={!dialogNameInput().trim()}
              onClick={submitRename}
            >
              Rename
            </button>
          </>
        }
      >
        <div class="dialog__field">
          <label for="rename-branch-name">New name</label>
          <input
            id="rename-branch-name"
            type="text"
            value={dialogNameInput()}
            onInput={(e) => setDialogNameInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
            }}
          />
        </div>
        <Show when={dialogError()}>
          <p class="dialog__error">{dialogError()}</p>
        </Show>
      </Dialog>

      <Dialog
        open={dialog()?.kind === "delete"}
        title={
          (dialog() as { unmerged?: boolean })?.unmerged
            ? "Force delete unmerged branch?"
            : "Delete branch"
        }
        onClose={closeDialog}
        footer={
          <>
            <button
              class="dialog__btn"
              type="button"
              data-dismiss
              onClick={closeDialog}
            >
              Cancel
            </button>
            <button
              class="dialog__btn dialog__btn--danger"
              type="button"
              onClick={() =>
                submitDelete(Boolean((dialog() as { unmerged?: boolean })?.unmerged))
              }
            >
              {(dialog() as { unmerged?: boolean })?.unmerged
                ? "Force delete"
                : "Delete"}
            </button>
          </>
        }
      >
        <Show
          when={(dialog() as { unmerged?: boolean })?.unmerged}
          fallback={
            <p>
              Delete local branch <code>{(dialog() as { name?: string })?.name}</code>?
            </p>
          }
        >
          <p>
            Branch <code>{(dialog() as { name?: string })?.name}</code> is not fully
            merged into HEAD. Deleting it may lose commits.
          </p>
        </Show>
        <Show when={dialogError()}>
          <p class="dialog__error">{dialogError()}</p>
        </Show>
      </Dialog>

      <Dialog
        open={dialog()?.kind === "checkout-dirty"}
        title="Uncommitted changes"
        onClose={closeDialog}
        footer={
          <>
            <button
              class="dialog__btn"
              type="button"
              data-dismiss
              onClick={closeDialog}
            >
              Cancel
            </button>
            <button
              class="dialog__btn dialog__btn--primary"
              type="button"
              onClick={() =>
                void stashAndCheckout(
                  (dialog() as { target: string }).target,
                )
              }
            >
              Stash & Checkout
            </button>
          </>
        }
      >
        <p>
          Your working tree has uncommitted changes. Stash them and switch to{" "}
          <code>{(dialog() as { target?: string })?.target}</code>?
        </p>
        <p style={{ color: "var(--fg-3)", "font-size": "12px", "margin-top": "8px" }}>
          You can restore the stash afterwards via the Stash section
          (coming with issue #12).
        </p>
        <Show when={dialogError()}>
          <p class="dialog__error">{dialogError()}</p>
        </Show>
      </Dialog>

      <Dialog
        open={dialog()?.kind === "merge-pick"}
        title={`Merge '${(dialog() as { source?: string })?.source ?? ""}' into current`}
        onClose={closeDialog}
        footer={
          <>
            <button
              class="dialog__btn"
              type="button"
              data-dismiss
              onClick={closeDialog}
            >
              Cancel
            </button>
            <button
              class="dialog__btn dialog__btn--primary"
              type="button"
              onClick={() => void submitMerge()}
            >
              Merge
            </button>
          </>
        }
      >
        <div class="dialog__field">
          <label>Strategy</label>
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <label style={{ display: "flex", gap: "6px", "align-items": "center" }}>
              <input
                type="radio"
                name="merge-strategy"
                value="fast-forward-or-merge"
                checked={mergeStrategy() === "fast-forward-or-merge"}
                onChange={() => setMergeStrategy("fast-forward-or-merge")}
              />
              <span>Fast-forward if possible, otherwise merge commit</span>
            </label>
            <label style={{ display: "flex", gap: "6px", "align-items": "center" }}>
              <input
                type="radio"
                name="merge-strategy"
                value="fast-forward-only"
                checked={mergeStrategy() === "fast-forward-only"}
                onChange={() => setMergeStrategy("fast-forward-only")}
              />
              <span>Fast-forward only (abort otherwise)</span>
            </label>
            <label style={{ display: "flex", gap: "6px", "align-items": "center" }}>
              <input
                type="radio"
                name="merge-strategy"
                value="no-fast-forward"
                checked={mergeStrategy() === "no-fast-forward"}
                onChange={() => setMergeStrategy("no-fast-forward")}
              />
              <span>Always create a merge commit (no fast-forward)</span>
            </label>
          </div>
        </div>
        <Show when={dialogError()}>
          <p class="dialog__error">{dialogError()}</p>
        </Show>
      </Dialog>

      <Dialog
        open={dialog()?.kind === "merge-result"}
        title={mergeResultTitle((dialog() as { result?: MergeResult })?.result)}
        onClose={closeDialog}
        footer={
          <Show
            when={(dialog() as { result?: MergeResult })?.result?.kind === "conflict"}
            fallback={
              <button
                class="dialog__btn dialog__btn--primary"
                type="button"
                data-dismiss
                onClick={closeDialog}
              >
                Close
              </button>
            }
          >
            <button
              class="dialog__btn dialog__btn--danger"
              type="button"
              onClick={() => void doAbortMerge()}
            >
              Abort merge
            </button>
            <button
              class="dialog__btn"
              type="button"
              data-dismiss
              onClick={closeDialog}
            >
              Leave for manual resolve
            </button>
          </Show>
        }
      >
        <Show
          when={dialog()?.kind === "merge-result"}
          fallback={null}
        >
          {(() => {
            const res = (dialog() as { result: MergeResult }).result;
            if (res.kind === "already-up-to-date") {
              return <p>Already up to date. No changes applied.</p>;
            }
            if (res.kind === "fast-forward") {
              return (
                <p>
                  Fast-forwarded HEAD to <code>{res.new_head.slice(0, 7)}</code>.
                </p>
              );
            }
            if (res.kind === "merged") {
              return (
                <p>
                  Created merge commit <code>{res.new_head.slice(0, 7)}</code>.
                </p>
              );
            }
            return (
              <>
                <p>Merge produced conflicts in:</p>
                <ul style={{ "font-family": "var(--font-mono)", "font-size": "12px", margin: "6px 0 0 16px" }}>
                  <For each={res.paths}>{(p) => <li>{p}</li>}</For>
                </ul>
                <p style={{ color: "var(--fg-3)", "font-size": "12px", "margin-top": "8px" }}>
                  The repo is in a merge-in-progress state. Resolve the files
                  manually (editor + <code>git add</code> + <code>git commit</code>)
                  — or wait for Chajá's conflict resolver (issue #10).
                  Click <strong>Abort merge</strong> to discard the merge
                  entirely (reset hard to HEAD).
                </p>
              </>
            );
          })()}
        </Show>
      </Dialog>

      <Dialog
        open={dialog()?.kind === "delete-remote"}
        title="Delete remote branch"
        onClose={closeDialog}
        footer={
          <>
            <button
              class="dialog__btn"
              type="button"
              data-dismiss
              onClick={closeDialog}
            >
              Cancel
            </button>
            <button
              class="dialog__btn dialog__btn--danger"
              type="button"
              onClick={() => void submitDeleteRemote()}
            >
              Delete remote
            </button>
          </>
        }
      >
        <p>
          Delete{" "}
          <code>
            {(dialog() as { remote?: string })?.remote}/
            {(dialog() as { name?: string })?.name}
          </code>{" "}
          from the remote? This cannot be undone without push access to the
          remote again.
        </p>
        <p style={{ color: "var(--fg-3)", "font-size": "12px", "margin-top": "8px" }}>
          Authentication uses your SSH agent. HTTPS credential helpers will
          land later.
        </p>
        <Show when={dialogError()}>
          <p class="dialog__error">{dialogError()}</p>
        </Show>
      </Dialog>
    </aside>
  );
}

function mergeResultTitle(result?: MergeResult): string {
  if (!result) return "Merge";
  switch (result.kind) {
    case "already-up-to-date":
      return "Already up to date";
    case "fast-forward":
      return "Fast-forwarded";
    case "merged":
      return "Merge commit created";
    case "conflict":
      return "Merge conflict";
  }
}

function stateBannerTitle(kind: string): string {
  switch (kind) {
    case "merge":
      return "Merge in progress";
    case "rebase":
      return "Rebase in progress";
    case "cherry-pick":
      return "Cherry-pick in progress";
    case "revert":
      return "Revert in progress";
    case "bisect":
      return "Bisect in progress";
    case "apply-mailbox":
      return "Patch application in progress";
    default:
      return `${kind} in progress`;
  }
}

/** Re-export a control so the shell can hide/show the whole sidebar via Ctrl+J handler. */
export const sidebarVisibility = { showLeftPanel, setShowLeftPanel } as const;
