// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { type WorktreeInfo } from "../../ipc";
import { setRepoPath } from "../../state";
import { openRepoInAnotherTab } from "../../tabs/ops";

interface WorktreeRowProps {
  worktree: WorktreeInfo;
  onContextMenu: (e: MouseEvent, w: WorktreeInfo) => void;
}

/// Strip the conventional `refs/heads/` prefix when present so the row
/// shows the branch name only. Detached worktrees report the literal
/// `HEAD`, which we surface verbatim with a small marker.
function branchLabel(branch: string): string {
  if (branch === "HEAD" || branch.length === 0) return "(detached)";
  return branch.replace(/^refs\/heads\//, "");
}

function workdirTail(workdir: string): string {
  const segs = workdir.split("/").filter(Boolean);
  return segs.length === 0 ? workdir : segs[segs.length - 1];
}

export function WorktreeRow(props: WorktreeRowProps) {
  const wt = () => props.worktree;
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    // Open the worktree as a separate REPO tab — matches GK behaviour
    // where clicking a worktree row switches the workspace to that
    // checkout. switchToRepoTabIfItExists in the ops layer dedupes if
    // the user already has the worktree open in another tab.
    setRepoPath(wt().workdir);
    void openRepoInAnotherTab(wt().workdir, !wt().is_main);
  };

  return (
    <div
      class="sidebar__branch-row sidebar__row--worktree"
      role="button"
      tabindex={0}
      title={wt().workdir}
      onClick={onClick}
      onContextMenu={(e) => props.onContextMenu(e, wt())}
    >
      <span class="sidebar__branch-name">{branchLabel(wt().branch)}</span>
      <span class="sidebar__row-meta">{workdirTail(wt().workdir)}</span>
      <Show when={wt().is_main}>
        <span class="sidebar__row-badge" title="Main worktree">main</span>
      </Show>
      <Show when={wt().locked}>
        <span
          class="sidebar__row-badge sidebar__row-badge--warn"
          title={wt().locked ?? "locked"}
        >
          locked
        </span>
      </Show>
      <Show when={wt().prunable}>
        <span
          class="sidebar__row-badge sidebar__row-badge--warn"
          title={wt().prunable ?? "prunable"}
        >
          prunable
        </span>
      </Show>
    </div>
  );
}
