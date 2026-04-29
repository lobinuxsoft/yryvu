// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";

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

const matches = (name: string, q: string) =>
  q === "" || name.toLowerCase().includes(q.toLowerCase());

export function LeftSidebar() {
  const [collapsed, setCollapsed] = createSignal(false);
  const [filterQuery, setFilterQuery] = createSignal("");
  let filterInputEl: HTMLInputElement | undefined;

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
  const filteredLocals = () => locals().filter((b) => matches(b.name, filterQuery()));
  const filteredRemotes = () => remotes().filter((b) => matches(b.name, filterQuery()));
  const isFiltering = () => filterQuery() !== "";
  const totalMatches = () =>
    isFiltering() ? filteredLocals().length + filteredRemotes().length : -1;

  const ops = useBranchOps();

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (collapsed()) setCollapsed(false);
        queueMicrotask(() => filterInputEl?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

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
        <div class="sidebar__filter" data-has-text={isFiltering() ? "true" : "false"}>
          <input
            ref={filterInputEl}
            type="text"
            placeholder="Filter (Ctrl+Alt+F)"
            value={filterQuery()}
            onInput={(e) => setFilterQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && isFiltering()) {
                e.preventDefault();
                setFilterQuery("");
              }
            }}
          />
          <Show when={isFiltering()}>
            <button
              type="button"
              class="sidebar__filter-clear"
              aria-label="Clear filter"
              title="Clear filter"
              onClick={() => {
                setFilterQuery("");
                filterInputEl?.focus();
              }}
            >
              ×
            </button>
          </Show>
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
          count={isFiltering() ? filteredLocals().length : locals().length}
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
              when={filteredLocals().length > 0}
              fallback={
                <p class="sidebar__empty">
                  {isFiltering()
                    ? "No matches"
                    : locals().length === 0
                      ? "No local branches"
                      : ""}
                </p>
              }
            >
              <For each={filteredLocals()}>
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
          count={isFiltering() ? filteredRemotes().length : remotes().length}
          onRefresh={() => void ops.refreshRemote()}
          refreshing={ops.refreshingRemote()}
        >
          <Show
            when={filteredRemotes().length > 0}
            fallback={
              <p class="sidebar__empty">
                {isFiltering()
                  ? "No matches"
                  : remotes().length === 0
                    ? "No remote branches"
                    : ""}
              </p>
            }
          >
            <For each={filteredRemotes()}>
              {(b) => (
                <RemoteBranchRow
                  branch={b}
                  onContextMenu={ops.openRemoteContextMenu}
                />
              )}
            </For>
          </Show>
        </SidebarSection>

        {/* Placeholder sections — hidden while filtering since they have no
            wired data sources yet (Tags #71, PRs #112, etc.). They reappear
            when the filter clears so layout matches GK at rest. */}
        <Show when={!isFiltering()}>
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
        </Show>

        <Show when={isFiltering() && totalMatches() === 0 && repoPath()}>
          <p class="sidebar__no-matches">
            No refs match "<span>{filterQuery()}</span>"
          </p>
        </Show>
      </div>

    </aside>
  );
}

/** Re-export a control so the shell can hide/show the whole sidebar via Ctrl+J handler. */
export const sidebarVisibility = { showLeftPanel, setShowLeftPanel } as const;
