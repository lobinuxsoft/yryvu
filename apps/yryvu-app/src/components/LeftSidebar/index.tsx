// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, onCleanup, onMount, Show } from "solid-js";

import {
  repoPath,
  setShowLeftPanel,
  showLeftPanel,
} from "../../state";
import { useBranchOps } from "../../branchOps";
import { Tooltip } from "../Tooltip";
import { AuxSections } from "./sections/AuxSections";
import { GitflowSection } from "./sections/GitflowSection";
import { RefsSections } from "./sections/RefsSections";
import { StateBanner } from "./StateBanner";
import { useSidebarData } from "./useSidebarData";

export function LeftSidebar() {
  const [collapsed, setCollapsed] = createSignal(false);
  const [filterQuery, setFilterQuery] = createSignal("");
  let filterInputEl: HTMLInputElement | undefined;

  const data = useSidebarData(filterQuery);
  const ops = useBranchOps();

  // Wire the section context menu's Hide-all / Show-all enablement to
  // our live resources. Done once at mount — the accessors stay valid
  // for the component's lifetime; the resource itself updates the
  // underlying signal so every subsequent menu open sees fresh data.
  ops.setBranchSource(() => data.branches() ?? []);
  ops.setTagSource(() => data.tags() ?? []);
  ops.setRemotesSource(() => data.remoteNames() ?? []);
  ops.setGitflowConfigSource(() => data.gitflowConfig() ?? null);

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
        <Tooltip text={collapsed() ? "Expand sidebar" : "Collapse to icons"}>
          <button
            class="tabs__leading-btn"
            type="button"
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed() ? "›" : "‹"}
          </button>
        </Tooltip>
        <Show when={!collapsed()}>
          <span>Viewing</span>
          <span class="sidebar__item-badge">{data.branches()?.length ?? 0}</span>
        </Show>
      </div>

      <Show when={collapsed()}>
        <Tooltip text="Yryvu">
          <div class="sidebar__brand-rail" aria-label="Yryvu" />
        </Tooltip>
      </Show>

      <Show when={!collapsed()}>
        <div
          class="sidebar__filter"
          data-has-text={data.isFiltering() ? "true" : "false"}
        >
          <input
            ref={filterInputEl}
            type="text"
            placeholder="Filter (Ctrl+Alt+F)"
            value={filterQuery()}
            onInput={(e) => setFilterQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && data.isFiltering()) {
                e.preventDefault();
                setFilterQuery("");
              }
            }}
          />
          <Show when={data.isFiltering()}>
            <Tooltip text="Clear filter">
              <button
                type="button"
                class="sidebar__filter-clear"
                aria-label="Clear filter"
                onClick={() => {
                  setFilterQuery("");
                  filterInputEl?.focus();
                }}
              >
                ×
              </button>
            </Tooltip>
          </Show>
        </div>
      </Show>

      <Show
        when={
          !collapsed() && data.repoState() && data.repoState()!.kind !== "clean"
        }
      >
        <StateBanner
          state={data.repoState()!}
          onAbortMerge={() => void ops.doAbortMerge()}
        />
      </Show>

      <div class="sidebar__sections">
        <RefsSections data={data} ops={ops} />
        <GitflowSection data={data} ops={ops} />
        <AuxSections data={data} ops={ops} />

        <Show
          when={data.isFiltering() && data.totalMatches() === 0 && repoPath()}
        >
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
