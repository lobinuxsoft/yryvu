// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";

import {
  getRepoState,
  listBranches,
  listStashes,
  listTags,
  listWorktrees,
  type BranchInfo,
  type RepoStateInfo,
  type StashInfo,
  type TagInfo,
  type WorktreeInfo,
} from "../../ipc";
import {
  branchesNonce,
  repoPath,
  setShowLeftPanel,
  showLeftPanel,
  workingTreeNonce,
} from "../../state";
import { useBranchOps } from "../../branchOps";
import {
  IconBranch,
  IconCircleDot,
  IconCloud,
  IconPullRequest,
  IconTag,
} from "../Icons";
import { LocalBranchRow, RemoteBranchRow } from "./branchRows";
import { SidebarSection } from "./SidebarSection";
import { StashRow } from "./stashRows";
import { StateBanner } from "./StateBanner";
import { TagRow } from "./tagRows";
import { WorktreeRow } from "./worktreeRows";

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

  // Tags share the same `branchesNonce` source-key as branches so any
  // ref-mutating op (including `createTag` via `useCommitOps`) refreshes
  // the list without a dedicated tagsNonce.
  const [tags] = createResource<TagInfo[], [string, number]>(
    () => [repoPath() ?? "", branchesNonce()] as [string, number],
    async ([path]) => {
      if (!path) return [] as TagInfo[];
      return await listTags(path);
    },
    { initialValue: [] },
  );

  // Worktrees use branchesNonce too — checking out a branch in another
  // worktree, removing one, or adding one all flow through ref-mutating
  // ops that bump the nonce. No dedicated worktreesNonce needed.
  const [worktrees] = createResource<WorktreeInfo[], [string, number]>(
    () => [repoPath() ?? "", branchesNonce()] as [string, number],
    async ([path]) => {
      if (!path) return [] as WorktreeInfo[];
      return await listWorktrees(path);
    },
    { initialValue: [] },
  );

  // Stashes are working-tree mutations (push/pop/drop) — workingTreeNonce
  // is the right source-key. Refs aren't involved unless the stash is
  // saved with a branch_name (informational only).
  const [stashes] = createResource<StashInfo[], [string, number]>(
    () => [repoPath() ?? "", workingTreeNonce()] as [string, number],
    async ([path]) => {
      if (!path) return [] as StashInfo[];
      return await listStashes(path);
    },
    { initialValue: [] },
  );

  const locals = () => (branches() ?? []).filter((b) => b.kind === "local");
  const remotes = () => (branches() ?? []).filter((b) => b.kind === "remote");
  const tagList = () => tags() ?? [];
  const worktreeList = () => worktrees() ?? [];
  const stashList = () => stashes() ?? [];
  const filteredLocals = () => locals().filter((b) => matches(b.name, filterQuery()));
  const filteredRemotes = () => remotes().filter((b) => matches(b.name, filterQuery()));
  const filteredTags = () => tagList().filter((t) => matches(t.name, filterQuery()));
  // Filter worktrees by branch name OR path tail — both are searchable signals.
  const filteredWorktrees = () =>
    worktreeList().filter(
      (w) => matches(w.branch, filterQuery()) || matches(w.workdir, filterQuery()),
    );
  // Stashes filter by message OR branch_name — branch is what users
  // remember when looking for a stash they took on a feature branch.
  const filteredStashes = () =>
    stashList().filter(
      (s) =>
        matches(s.message, filterQuery()) ||
        matches(s.branch_name ?? "", filterQuery()),
    );
  const isFiltering = () => filterQuery() !== "";
  const totalMatches = () =>
    isFiltering()
      ? filteredLocals().length +
        filteredRemotes().length +
        filteredTags().length +
        filteredWorktrees().length +
        filteredStashes().length
      : -1;

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

        <SidebarSection
          title="Worktrees"
          icon={<IconBranch />}
          count={
            isFiltering() ? filteredWorktrees().length : worktreeList().length
          }
        >
          <Show
            when={repoPath()}
            fallback={
              <p class="sidebar__empty">Open a repo to list worktrees</p>
            }
          >
            <Show
              when={filteredWorktrees().length > 0}
              fallback={
                <p class="sidebar__empty">
                  {isFiltering()
                    ? "No matches"
                    : worktreeList().length === 0
                      ? "No worktrees"
                      : ""}
                </p>
              }
            >
              <For each={filteredWorktrees()}>
                {(w) => <WorktreeRow worktree={w} />}
              </For>
            </Show>
          </Show>
        </SidebarSection>

        <SidebarSection
          title="Stashes"
          icon={<IconBranch />}
          count={
            isFiltering() ? filteredStashes().length : stashList().length
          }
        >
          <Show
            when={repoPath()}
            fallback={
              <p class="sidebar__empty">Open a repo to list stashes</p>
            }
          >
            <Show
              when={filteredStashes().length > 0}
              fallback={
                <p class="sidebar__empty">
                  {isFiltering()
                    ? "No matches"
                    : stashList().length === 0
                      ? "No stashes"
                      : ""}
                </p>
              }
            >
              <For each={filteredStashes()}>
                {(s, i) => <StashRow stash={s} index={i()} />}
              </For>
            </Show>
          </Show>
        </SidebarSection>

        {/* Provider-backed sections — render bodies once #46 OAuth lands.
            Hidden during filter since no live data feeds them yet. */}
        <Show when={!isFiltering()}>
          <SidebarSection
            title="Pull Requests"
            icon={<IconPullRequest />}
            count={0}
            addable
          >
            <p class="sidebar__empty">Connect a Git provider to list PRs</p>
          </SidebarSection>
          <SidebarSection
            title="Issues"
            icon={<IconCircleDot />}
            count={0}
          >
            <p class="sidebar__empty">Connect a Git provider to list issues</p>
          </SidebarSection>
        </Show>

        <SidebarSection
          title="Tags"
          icon={<IconTag />}
          count={isFiltering() ? filteredTags().length : tagList().length}
        >
          <Show
            when={repoPath()}
            fallback={<p class="sidebar__empty">Open a repo to list tags</p>}
          >
            <Show
              when={filteredTags().length > 0}
              fallback={
                <p class="sidebar__empty">
                  {isFiltering()
                    ? "No matches"
                    : tagList().length === 0
                      ? "No tags"
                      : ""}
                </p>
              }
            >
              <For each={filteredTags()}>{(t) => <TagRow tag={t} />}</For>
            </Show>
          </Show>
        </SidebarSection>

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
