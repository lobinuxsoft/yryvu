// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import type { BranchOps } from "../../../branchOps";
import { hiddenSections, repoPath } from "../../../state";
import { IconBranch } from "../../Icons";
import { LocalBranchRow } from "../branchRows";
import { SidebarSection } from "../SidebarSection";
import type { SidebarData } from "../useSidebarData";

interface Props {
  data: SidebarData;
  ops: BranchOps;
}

/**
 * GITFLOW section (issue #19). Structurally just the LOCAL refs that
 * belong to the gitflow model (production + integration branches plus
 * anything under a configured topic prefix), re-grouped under a
 * dedicated header — same `LocalBranchRow`, same per-branch menu.
 *
 * Only renders when the repo has a `[gitflow]` config: mirrors GK's
 * "section appears once `git flow init` ran" behaviour. The header `+`
 * opens the Git Flow start/finish menu; right-click opens the standard
 * section visibility menu.
 */
export function GitflowSection(props: Props) {
  return (
    <Show
      when={!hiddenSections().has("GITFLOW") && props.data.gitflowConfig()}
    >
      <SidebarSection
        sectionKey="GITFLOW"
        title="Git Flow"
        icon={<IconBranch />}
        count={props.data.filteredGitflowLocals().length}
        addable
        onAdd={(e) => props.ops.openGitflowMenu(e)}
        onContextMenu={props.ops.openSectionContextMenu}
      >
        <Show
          when={repoPath()}
          fallback={<p class="sidebar__empty">Open a repo</p>}
        >
          <Show
            when={props.data.filteredGitflowLocals().length > 0}
            fallback={
              <p class="sidebar__empty">
                {props.data.isFiltering()
                  ? "No matches"
                  : "No gitflow branches yet — use + to start one"}
              </p>
            }
          >
            <For each={props.data.filteredGitflowLocals()}>
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
  );
}
