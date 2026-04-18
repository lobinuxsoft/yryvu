// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createResource,
  createSignal,
  For,
  type JSX,
  Show,
} from "solid-js";

import {
  createBranch,
  deleteLocalBranch,
  listBranches,
  renameBranch,
  type BranchInfo,
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
  | null;

export function LeftSidebar() {
  const [collapsed, setCollapsed] = createSignal(false);
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [dialog, setDialog] = createSignal<DialogState>(null);
  const [dialogError, setDialogError] = createSignal<string | null>(null);
  const [dialogNameInput, setDialogNameInput] = createSignal("");

  const [branches, { refetch }] = createResource<BranchInfo[], string>(
    () => repoPath() ?? "",
    async (path) => {
      if (!path) return [] as BranchInfo[];
      return await listBranches(path);
    },
    { initialValue: [] },
  );

  const locals = () => (branches() ?? []).filter((b) => b.kind === "local");
  const remotes = () => (branches() ?? []).filter((b) => b.kind === "remote");

  function openBranchContextMenu(e: MouseEvent, b: BranchInfo) {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      {
        label: "Create branch here",
        onSelect: () => openCreateDialog(b.tip_sha),
      },
      { type: "separator" },
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
    const items: ContextMenuItem[] = [
      {
        label: "Create branch here",
        onSelect: () => openCreateDialog(b.tip_sha),
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
  function closeDialog() {
    setDialog(null);
    setDialogError(null);
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
      refetch();
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
      refetch();
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
      refetch();
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
                    title={b.upstream ? `tracks ${b.upstream}` : "no upstream"}
                    onContextMenu={(e) => openBranchContextMenu(e, b)}
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

        <SidebarSection title="Remote" icon={<IconCloud />} count={remotes().length}>
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
    </aside>
  );
}

/** Re-export a control so the shell can hide/show the whole sidebar via Ctrl+J handler. */
export const sidebarVisibility = { showLeftPanel, setShowLeftPanel } as const;
