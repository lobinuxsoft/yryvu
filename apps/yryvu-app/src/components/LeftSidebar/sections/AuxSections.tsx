// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Match, Show, Switch } from "solid-js";

import type { BranchOps } from "../../../branchOps";
import { hiddenSections, repoPath } from "../../../state";
import {
  prStateFilter,
  prTextFilter,
  pullRequests,
} from "../../../state/pull-requests";
import {
  issueStateFilter,
  issueTextFilter,
  issues,
} from "../../../state/issues";
import { InlineConnectCta } from "../../CallToActions/InlineConnectCta";
import {
  IconBranch,
  IconCircleDot,
  IconPullRequest,
} from "../../Icons";
import { SidebarSection } from "../SidebarSection";
import { IssueRow } from "../issueRows";
import { IssuesToolbar } from "../issuesToolbar";
import { PullRequestRow } from "../pullRequestRows";
import { PullRequestToolbar } from "../pullRequestToolbar";
import { StashRow } from "../stashRows";
import { SubmoduleRow } from "../submoduleRows";
import { WorktreeRow } from "../worktreeRows";
import type { SidebarData } from "../useSidebarData";
import type { IssueSummary, PullRequestSummary } from "../../../ipc";
import { openCreateIssueDialog } from "../../CreateIssueDialog/state";
import { openCreatePrDialog } from "../../CreatePrDialog/state";

/// Apply the toolbar's state + text filter to a row list. Shared
/// helper used by both the PR and Issue panels.
function applyRowFilter<T extends { state: string; title: string }>(
  rows: T[],
  state: "open" | "closed" | "all",
  text: string,
): T[] {
  const lower = text.trim().toLowerCase();
  return rows.filter((row) => {
    if (state !== "all") {
      const isOpen = row.state === "open";
      if (state === "open" && !isOpen) return false;
      // "closed" treats both `closed` and `merged` PR states as
      // "no longer actionable" so they fall in this bucket.
      if (state === "closed" && isOpen) return false;
    }
    if (lower.length > 0 && !row.title.toLowerCase().includes(lower)) {
      return false;
    }
    return true;
  });
}

interface Props {
  data: SidebarData;
  ops: BranchOps;
}

/**
 * Auxiliary sections — Worktrees, Stashes, Pull Requests, Issues,
 * Submodules. Pull Requests + Issues stay placeholder bodies until #46
 * (OAuth) lands; they're hidden during filtering since no live data
 * feeds them yet. Splitting them out here keeps the orchestrator file
 * focused on the toolbar / banner / wiring.
 */
export function AuxSections(props: Props) {
  return (
    <>
      <Show when={!hiddenSections().has("WORKTREES")}>
        <SidebarSection
          sectionKey="WORKTREES"
          title="Worktrees"
          icon={<IconBranch />}
          count={
            props.data.isFiltering()
              ? props.data.filteredWorktrees().length
              : props.data.worktreeList().length
          }
          onContextMenu={props.ops.openSectionContextMenu}
        >
          <Show
            when={repoPath()}
            fallback={
              <p class="sidebar__empty">Open a repo to list worktrees</p>
            }
          >
            <Show
              when={props.data.filteredWorktrees().length > 0}
              fallback={
                <p class="sidebar__empty">
                  {props.data.isFiltering()
                    ? "No matches"
                    : props.data.worktreeList().length === 0
                      ? "No worktrees"
                      : ""}
                </p>
              }
            >
              <For each={props.data.filteredWorktrees()}>
                {(w) => (
                  <WorktreeRow
                    worktree={w}
                    onContextMenu={props.ops.openWorktreeContextMenu}
                  />
                )}
              </For>
            </Show>
          </Show>
        </SidebarSection>
      </Show>

      <Show when={!hiddenSections().has("STASHES")}>
        <SidebarSection
          sectionKey="STASHES"
          title="Stashes"
          icon={<IconBranch />}
          count={
            props.data.isFiltering()
              ? props.data.filteredStashes().length
              : props.data.stashList().length
          }
          onContextMenu={props.ops.openSectionContextMenu}
        >
          <Show
            when={repoPath()}
            fallback={
              <p class="sidebar__empty">Open a repo to list stashes</p>
            }
          >
            <Show
              when={props.data.filteredStashes().length > 0}
              fallback={
                <p class="sidebar__empty">
                  {props.data.isFiltering()
                    ? "No matches"
                    : props.data.stashList().length === 0
                      ? "No stashes"
                      : ""}
                </p>
              }
            >
              <For each={props.data.filteredStashes()}>
                {(s, i) => (
                  <StashRow
                    stash={s}
                    index={i()}
                    onContextMenu={props.ops.openStashContextMenu}
                  />
                )}
              </For>
            </Show>
          </Show>
        </SidebarSection>
      </Show>

      {/* Provider-backed PR section — wave-2 scope of #360.
          GitHub repos with the `"github"` integration configured fetch
          live data via `integration_list_prs`; the filter toolbar
          drives the GraphQL search dispatch path on the backend.
          Other states fall through to the inline-connect CTA or a
          small empty hint. Hidden during the LeftSidebar branch
          filter (sidebar __row__ filter targets local refs; PR
          filtering is independent and lives on the PR toolbar). */}
      <Show
        when={!props.data.isFiltering() && !hiddenSections().has("PULL_REQUESTS")}
      >
        <SidebarSection
          sectionKey="PULL_REQUESTS"
          title="Pull Requests"
          icon={<IconPullRequest />}
          count={
            pullRequests()?.kind === "ready"
              ? (pullRequests() as { kind: "ready"; prs: unknown[] }).prs.length
              : 0
          }
          addable={pullRequests()?.kind === "ready"}
          onAdd={() => openCreatePrDialog()}
          onContextMenu={props.ops.openSectionContextMenu}
        >
          <Show when={repoPath() && pullRequests()?.kind === "ready"}>
            <PullRequestToolbar />
          </Show>
          <Switch fallback={<InlineConnectCta kind="pull-requests" />}>
            <Match when={!repoPath()}>
              <p class="sidebar__empty">Open a repo to list pull requests</p>
            </Match>
            <Match when={pullRequests.loading}>
              <p class="sidebar__empty">Loading…</p>
            </Match>
            <Match when={pullRequests()?.kind === "unsupported-provider"}>
              <p class="sidebar__empty">
                Pull-request panel supports GitHub, GitLab and Gitea /
                Forgejo. Other providers (Bitbucket, Azure DevOps) are
                not on the v1 roadmap.
              </p>
            </Match>
            <Match when={pullRequests()?.kind === "bare-or-unparseable"}>
              <p class="sidebar__empty">
                Repo has no recognisable origin remote.
              </p>
            </Match>
            <Match when={pullRequests()?.kind === "not-connected"}>
              <InlineConnectCta kind="pull-requests" />
            </Match>
            <Match when={pullRequests()?.kind === "error"}>
              <p class="sidebar__empty">
                {(pullRequests() as { kind: "error"; detail: string }).detail}
              </p>
            </Match>
            <Match when={pullRequests()?.kind === "ready"}>
              {(() => {
                const prs = (pullRequests() as {
                  kind: "ready";
                  prs: PullRequestSummary[];
                }).prs;
                const visible = applyRowFilter(
                  prs,
                  prStateFilter(),
                  prTextFilter(),
                );
                return (
                  <Show
                    when={visible.length > 0}
                    fallback={
                      <p class="sidebar__empty">
                        {prs.length === 0
                          ? "No pull requests"
                          : "No matches for current filter"}
                      </p>
                    }
                  >
                    <For each={visible}>{(pr) => <PullRequestRow pr={pr} />}</For>
                  </Show>
                );
              })()}
            </Match>
          </Switch>
        </SidebarSection>
      </Show>
      {/* Provider-backed Issues section — wave-1 of #97. Reuses the
          same provider classification + connected-state plumbing as
          the PR panel, just keyed on a separate resource so the two
          refetch independently. */}
      <Show when={!props.data.isFiltering() && !hiddenSections().has("ISSUES")}>
        <SidebarSection
          sectionKey="ISSUES"
          title="Issues"
          icon={<IconCircleDot />}
          count={
            issues()?.kind === "ready"
              ? (issues() as { kind: "ready"; issues: unknown[] }).issues.length
              : 0
          }
          addable={issues()?.kind === "ready"}
          onAdd={() => openCreateIssueDialog()}
          onContextMenu={props.ops.openSectionContextMenu}
        >
          <Show when={repoPath() && issues()?.kind === "ready"}>
            <IssuesToolbar />
          </Show>
          <Switch fallback={<InlineConnectCta kind="issues" />}>
            <Match when={!repoPath()}>
              <p class="sidebar__empty">Open a repo to list issues</p>
            </Match>
            <Match when={issues.loading}>
              <p class="sidebar__empty">Loading…</p>
            </Match>
            <Match when={issues()?.kind === "unsupported-provider"}>
              <p class="sidebar__empty">
                Issues panel supports GitHub, GitLab and Gitea / Forgejo.
              </p>
            </Match>
            <Match when={issues()?.kind === "bare-or-unparseable"}>
              <p class="sidebar__empty">Repo has no recognisable origin remote.</p>
            </Match>
            <Match when={issues()?.kind === "not-connected"}>
              <InlineConnectCta kind="issues" />
            </Match>
            <Match when={issues()?.kind === "error"}>
              <p class="sidebar__empty">
                {(issues() as { kind: "error"; detail: string }).detail}
              </p>
            </Match>
            <Match when={issues()?.kind === "ready"}>
              {(() => {
                const rows = (issues() as { kind: "ready"; issues: IssueSummary[] }).issues;
                const visible = applyRowFilter(
                  rows,
                  issueStateFilter(),
                  issueTextFilter(),
                );
                return (
                  <Show
                    when={visible.length > 0}
                    fallback={
                      <p class="sidebar__empty">
                        {rows.length === 0
                          ? "No issues"
                          : "No matches for current filter"}
                      </p>
                    }
                  >
                    <For each={visible}>{(issue) => <IssueRow issue={issue} />}</For>
                  </Show>
                );
              })()}
            </Match>
          </Switch>
        </SidebarSection>
      </Show>

      <Show when={!hiddenSections().has("SUBMODULES")}>
        <SidebarSection
          sectionKey="SUBMODULES"
          title="Submodules"
          icon={<IconBranch />}
          count={
            props.data.isFiltering()
              ? props.data.filteredSubmodules().length
              : props.data.submoduleList().length
          }
          addable
          onAdd={() => props.ops.openSubmoduleAddDialog()}
          onContextMenu={props.ops.openSectionContextMenu}
        >
          <Show
            when={repoPath()}
            fallback={
              <p class="sidebar__empty">Open a repo to list submodules</p>
            }
          >
            <Show
              when={props.data.filteredSubmodules().length > 0}
              fallback={
                <p class="sidebar__empty">
                  {props.data.isFiltering()
                    ? "No matches"
                    : props.data.submoduleList().length === 0
                      ? "No submodules"
                      : ""}
                </p>
              }
            >
              <For each={props.data.filteredSubmodules()}>
                {(s) => (
                  <SubmoduleRow
                    sub={s}
                    onContextMenu={props.ops.openSubmoduleContextMenu}
                  />
                )}
              </For>
            </Show>
          </Show>
        </SidebarSection>
      </Show>
    </>
  );
}
