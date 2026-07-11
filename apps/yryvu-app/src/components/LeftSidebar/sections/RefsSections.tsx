// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import type { BranchOps } from "../../../branchOps";
import {
  collapsedRemoteFolders,
  hiddenSections,
  repoPath,
  toggleRemoteFolderCollapsed,
} from "../../../state";

import { LocalBranchRow, RemoteBranchRow } from "../branchRows";
import { RemoteFolderRow } from "../remoteFolderRow";
import { SidebarSection } from "../SidebarSection";
import { TagRow } from "../tagRows";
import type { SidebarData } from "../useSidebarData";
import { Icon } from "../../Icon";

interface Props {
  data: SidebarData;
  ops: BranchOps;
}

/**
 * Ref-shaped sections — Local, Remote, Tags. Share the same `<Show
 * when={!hiddenSections().has(KEY)}>` gating + `repoPath()` empty-state
 * fallback, but the row component differs so each section keeps a
 * dedicated block. Splitting refs vs aux sections lets each file stay
 * around 100 LOC.
 */
export function RefsSections(props: Props) {
  return (
    <>
      <Show when={!hiddenSections().has("LOCAL")}>
        <SidebarSection
          sectionKey="LOCAL"
          title="Local"
          icon={<Icon name="branch" />}
          count={
            props.data.isFiltering()
              ? props.data.filteredLocals().length
              : props.data.locals().length
          }
          addable
          onAdd={() => props.ops.openCreateDialog()}
          onContextMenu={props.ops.openSectionContextMenu}
        >
          <Show
            when={repoPath()}
            fallback={
              <p class="sidebar__empty">Open a repo to list branches</p>
            }
          >
            <Show
              when={props.data.filteredLocals().length > 0}
              fallback={
                <p class="sidebar__empty">
                  {props.data.isFiltering()
                    ? "No matches"
                    : props.data.locals().length === 0
                      ? "No local branches"
                      : ""}
                </p>
              }
            >
              <For each={props.data.filteredLocals()}>
                {(b) => (
                  <LocalBranchRow
                    branch={b}
                    onContextMenu={props.ops.openBranchContextMenu}
                    onCheckout={(n) => void props.ops.tryCheckout(n)}
                  />
                )}
              </For>
            </Show>
          </Show>
        </SidebarSection>
      </Show>

      <Show when={!hiddenSections().has("REMOTE")}>
        <SidebarSection
          sectionKey="REMOTE"
          title="Remote"
          icon={<Icon name="cloud" />}
          count={
            props.data.isFiltering()
              ? props.data.filteredRemotes().length
              : props.data.remotes().length
          }
          onRefresh={() => void props.ops.refreshRemote()}
          refreshing={props.ops.refreshingRemote()}
          onContextMenu={(e) => props.ops.openRemoteHeaderContextMenu(e)}
        >
          <Show
            when={props.data.groupedRemotes().length > 0}
            fallback={
              <p class="sidebar__empty">
                {props.data.isFiltering() ? "No matches" : "No remotes"}
              </p>
            }
          >
            <For each={props.data.groupedRemotes()}>
              {(group) => (
                <>
                  <RemoteFolderRow
                    remote={group.remote}
                    count={group.branches.length}
                    collapsed={collapsedRemoteFolders(repoPath() ?? "").has(
                      group.remote,
                    )}
                    onToggle={(r) =>
                      toggleRemoteFolderCollapsed(repoPath() ?? "", r)
                    }
                    onContextMenu={(e, r) =>
                      props.ops.openRemoteFolderContextMenu(e, r)
                    }
                  />
                  <Show
                    when={
                      props.data.isFiltering() ||
                      !collapsedRemoteFolders(repoPath() ?? "").has(
                        group.remote,
                      )
                    }
                  >
                    <For each={group.branches}>
                      {(b) => (
                        <RemoteBranchRow
                          branch={b}
                          displayName={b.name.slice(group.remote.length + 1)}
                          nested
                          onContextMenu={props.ops.openRemoteContextMenu}
                        />
                      )}
                    </For>
                  </Show>
                </>
              )}
            </For>
          </Show>
        </SidebarSection>
      </Show>

      <Show when={!hiddenSections().has("TAGS")}>
        <SidebarSection
          sectionKey="TAGS"
          title="Tags"
          icon={<Icon name="tag" />}
          count={
            props.data.isFiltering()
              ? props.data.filteredTags().length
              : props.data.tagList().length
          }
          onContextMenu={props.ops.openSectionContextMenu}
        >
          <Show
            when={repoPath()}
            fallback={<p class="sidebar__empty">Open a repo to list tags</p>}
          >
            <Show
              when={props.data.filteredTags().length > 0}
              fallback={
                <p class="sidebar__empty">
                  {props.data.isFiltering()
                    ? "No matches"
                    : props.data.tagList().length === 0
                      ? "No tags"
                      : ""}
                </p>
              }
            >
              <For each={props.data.filteredTags()}>
                {(t) => (
                  <TagRow tag={t} onContextMenu={props.ops.openTagContextMenu} />
                )}
              </For>
            </Show>
          </Show>
        </SidebarSection>
      </Show>
    </>
  );
}
