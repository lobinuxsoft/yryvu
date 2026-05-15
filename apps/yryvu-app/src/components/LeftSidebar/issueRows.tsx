// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { IssueSummary } from "../../ipc";
import { openIssueDetail } from "../../state/issue-detail";
import { activeIssuesContext } from "../../state/issues";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { LabelChips, UserAvatarCluster } from "./pullRequestChips";

interface IssueRowProps {
  issue: IssueSummary;
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (deltaSeconds < 60) return "just now";
  const m = Math.floor(deltaSeconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/// Open the in-app issue detail panel for `issue`. Pulls integration
/// metadata from the live resource context so we don't need to
/// re-classify the repo per click.
function openDetail(issue: IssueSummary) {
  const ctx = activeIssuesContext();
  if (!ctx) return;
  openIssueDetail({
    integrationType: ctx.integrationType,
    owner: ctx.owner,
    repo: ctx.repo,
    number: issue.number,
  });
}

function buildMenuItems(issue: IssueSummary): ContextMenuItem[] {
  return [
    {
      label: "Open issue detail",
      onSelect: () => openDetail(issue),
    },
    {
      label: "View issue in browser",
      onSelect: () => {
        void openUrl(issue.htmlUrl);
      },
    },
    {
      label: "Copy issue link",
      onSelect: () => {
        void navigator.clipboard.writeText(issue.htmlUrl);
      },
    },
  ];
}

function hasSecondaryContent(issue: IssueSummary): boolean {
  return issue.labels.length > 0 || issue.assignees.length > 0 || issue.comments > 0;
}

export function IssueRow(props: IssueRowProps) {
  const issue = () => props.issue;
  const [menuAt, setMenuAt] = createSignal<{ x: number; y: number } | null>(null);
  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    setMenuAt({ x: e.clientX, y: e.clientY });
  };
  const openMenuFromButton = (e: MouseEvent & { currentTarget: HTMLElement }) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuAt({ x: rect.right, y: rect.bottom });
  };
  return (
    <div
      class="sidebar__branch-row sidebar__row--pull-request"
      title={`${issue().title} (#${issue().number}) — opened ${relativeTime(issue().createdAt)} by ${issue().author.login}`}
      onContextMenu={openMenu}
      onClick={() => openDetail(issue())}
    >
      <div class="sidebar__pr-row__primary">
        <Show when={issue().author.avatarUrl}>
          <img
            class="sidebar__row-avatar"
            src={issue().author.avatarUrl}
            alt={issue().author.login}
            loading="lazy"
          />
        </Show>
        <span class="sidebar__row-counter">{`#${issue().number}`}</span>
        <span class="sidebar__branch-name">{issue().title}</span>
        <span
          class="sidebar__row-badge sidebar__row-badge--pr-state"
          data-state={issue().state}
        >
          {issue().state}
        </span>
        <span class="sidebar__row-meta">{relativeTime(issue().updatedAt)}</span>
        <button
          type="button"
          class="sidebar__pr-row__kebab"
          title="Issue actions"
          aria-label="Issue actions"
          onClick={openMenuFromButton}
        >
          ⋮
        </button>
      </div>
      <Show when={hasSecondaryContent(issue())}>
        <div class="sidebar__pr-row__secondary">
          <LabelChips labels={issue().labels} />
          <UserAvatarCluster users={issue().assignees} kind="assignees" />
          <Show when={issue().comments > 0}>
            <span class="sidebar__row-comments" title={`${issue().comments} comments`}>
              💬 {issue().comments}
            </span>
          </Show>
        </div>
      </Show>
      <Show when={menuAt()}>
        {(anchor) => (
          <ContextMenu
            x={anchor().x}
            y={anchor().y}
            items={buildMenuItems(issue())}
            onClose={() => setMenuAt(null)}
          />
        )}
      </Show>
    </div>
  );
}
