// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal, For, Show } from "solid-js";

import { listBranches, getRepoState, type BranchInfo, type RepoStateInfo } from "../../ipc";
import {
  branchesNonce,
  repoPath,
  setShowLeftPanel,
  showLeftPanel,
} from "../../state";
import { useBranchOps } from "../../branchOps";
import {
  IconArchive,
  IconBranch,
  IconCircleDot,
  IconCloud,
  IconPullRequest,
  IconTag,
  IconUsers,
} from "../Icons";
import { LocalBranchRow, RemoteBranchRow } from "./branchRows";
import { SidebarSection } from "./SidebarSection";
import { StateBanner } from "./StateBanner";

export function LeftSidebar() {
  const [collapsed, setCollapsed] = createSignal(false);

  const [branches] = createResource<BranchInfo[], [string, number]>(
    () => [repoPath() ?? "", branchesNonce()] as [string, number],
    async ([path]) => {
      if (!path) return [] as BranchInfo[];
      return await listBranches(path);
    },
    { initialValue: [] },
  );

  const [repoState] = createResource<RepoStateInfo, [string, number]>(
    () => [repoPath() ?? "", branchesNonce()] as [string, number],
    async ([path]) => {
      if (!path) return { kind: "clean", conflict_paths: [] };
      return await getRepoState(path);
    },
    { initialValue: { kind: "clean", conflict_paths: [] } },
  );

  const locals = () => (branches() ?? []).filter((b) => b.kind === "local");
  const remotes = () => (branches() ?? []).filter((b) => b.kind === "remote");

  const ops = useBranchOps();

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
          !collapsed() && repoState() && repoState()!.kind !== "clean"
        }
      >
        <StateBanner
          state={repoState()!}
          onAbortMerge={() => void ops.doAbortMerge()}
        />
      </Show>

      <div class="sidebar__sections">
        <SidebarSection
          title="Local"
          icon={<IconBranch />}
          count={locals().length}
          initialExpanded
          addable
          onAdd={() => ops.openCreateDialog()}
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
                  <LocalBranchRow
                    branch={b}
                    onContextMenu={ops.openBranchContextMenu}
                    onCheckout={(n) => void ops.tryCheckout(n)}
                  />
                )}
              </For>
            </Show>
          </Show>
        </SidebarSection>

        <SidebarSection
          title="Remote"
          icon={<IconCloud />}
          count={remotes().length}
          onRefresh={() => void ops.refreshRemote()}
          refreshing={ops.refreshingRemote()}
        >
          <Show
            when={remotes().length > 0}
            fallback={<p class="sidebar__empty">No remote branches</p>}
          >
            <For each={remotes()}>
              {(b) => (
                <RemoteBranchRow
                  branch={b}
                  onContextMenu={ops.openRemoteContextMenu}
                />
              )}
            </For>
          </Show>
        </SidebarSection>

        <SidebarSection title="Cloud Patches" icon={<IconArchive />} count={0}>
          <p class="sidebar__empty">—</p>
        </SidebarSection>
        <SidebarSection
          title="Pull Requests"
          icon={<IconPullRequest />}
          count={0}
          addable
        >
          <p class="sidebar__empty">—</p>
        </SidebarSection>
        <SidebarSection
          title="GitHub Issues"
          icon={<IconCircleDot />}
          count={0}
        >
          <p class="sidebar__empty">—</p>
        </SidebarSection>
        <SidebarSection title="Tags" icon={<IconTag />} count={0}>
          <p class="sidebar__empty">—</p>
        </SidebarSection>
        <SidebarSection title="Teams" icon={<IconUsers />} count={0}>
          <p class="sidebar__empty">—</p>
        </SidebarSection>
      </div>

    </aside>
  );
}

/** Re-export a control so the shell can hide/show the whole sidebar via Ctrl+J handler. */
export const sidebarVisibility = { showLeftPanel, setShowLeftPanel } as const;
