// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { PullRequestSummary } from "../../ipc";
import { setSelectedCommit } from "../../state";
import { openPrDetail } from "../../state/pr-detail";
import { activePrContext } from "../../state/pull-requests";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { CiBadge, ReviewBadge } from "./pullRequestBadges";
import { LabelChips, UserAvatarCluster } from "./pullRequestChips";

interface PullRequestRowProps {
  pr: PullRequestSummary;
}

/// Open the in-app detail panel for this PR. Pulls integration
/// metadata from the live resource context so we don't need to
/// re-classify the repo per click.
function openDetail(pr: PullRequestSummary) {
  const ctx = activePrContext();
  if (!ctx) return;
  openPrDetail({
    integrationType: ctx.integrationType,
    owner: ctx.owner,
    repo: ctx.repo,
    number: pr.number,
    headSha: pr.headSha,
  });
}

/// Compose the 6-action kebab menu for a PR row. The leading item
/// mirrors the in-app detail view (#91); the rest mirror the
/// `PullRequestBar-*` strings from the GK bundle audit.
function buildMenuItems(pr: PullRequestSummary): ContextMenuItem[] {
  return [
    {
      label: "Open pull request detail",
      onSelect: () => openDetail(pr),
    },
    {
      label: "View pull request in browser",
      onSelect: () => {
        void openUrl(pr.htmlUrl);
      },
    },
    {
      label: "Copy pull request link",
      onSelect: () => {
        void navigator.clipboard.writeText(pr.htmlUrl);
      },
    },
    {
      label: "Review pull request",
      onSelect: () => {
        void openUrl(`${pr.htmlUrl}/files`);
      },
    },
    {
      label: "Go to head commit in graph",
      disabled: !pr.headSha,
      title: pr.headSha
        ? undefined
        : "Head SHA not available — opening the PR in the browser will refresh it",
      onSelect: () => {
        if (pr.headSha) setSelectedCommit(pr.headSha);
      },
    },
    {
      label: "View CI checks in browser",
      disabled: pr.ciStatus === null,
      title:
        pr.ciStatus === null
          ? "No CI runs reported on the head commit"
          : undefined,
      onSelect: () => {
        void openUrl(`${pr.htmlUrl}/checks`);
      },
    },
  ];
}

/// Relative-time formatter — same shape as `stashRows.relativeTime`
/// but takes an ISO-8601 string (GitHub `created_at` shape). Keep
/// both surfaces visually consistent.
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

/// Pick the surface label for the state badge. `draft` short-circuits
/// `open` because GitHub returns drafts as `state: "open"` plus a
/// separate `draft: true` flag and the badge should distinguish them.
function badgeLabel(pr: PullRequestSummary): string {
  if (pr.draft) return "draft";
  return pr.state;
}

function badgeVariant(pr: PullRequestSummary): string {
  if (pr.draft) return "draft";
  return pr.state;
}

/// True when the PR carries any wave-2 chip or badge content — drives
/// whether the secondary row (chips + badges) renders at all. Empty
/// secondary row means the PR collapses to the same height as the
/// walking-skeleton card.
function hasSecondaryContent(pr: PullRequestSummary): boolean {
  return (
    pr.labels.length > 0 ||
    pr.assignees.length > 0 ||
    pr.requestedReviewers.length > 0 ||
    pr.reviewDecision !== null ||
    pr.ciStatus !== null
  );
}

export function PullRequestRow(props: PullRequestRowProps) {
  const pr = () => props.pr;
  const [menuAt, setMenuAt] = createSignal<{ x: number; y: number } | null>(
    null,
  );
  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    setMenuAt({ x: e.clientX, y: e.clientY });
  };
  const openMenuFromButton = (e: MouseEvent & { currentTarget: HTMLElement }) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    // Anchor the menu at the button's bottom-right so the labels read
    // naturally to the left; ContextMenu clamps to the viewport if
    // there's no room.
    setMenuAt({ x: rect.right, y: rect.bottom });
  };
  return (
    <div
      class="sidebar__branch-row sidebar__row--pull-request"
      title={`${pr().title} (#${pr().number}) — opened ${relativeTime(pr().createdAt)} by ${pr().author.login}`}
      onContextMenu={openMenu}
      onClick={() => openDetail(pr())}
    >
      <div class="sidebar__pr-row__primary">
        <Show when={pr().author.avatarUrl}>
          <img
            class="sidebar__row-avatar"
            src={pr().author.avatarUrl}
            alt={pr().author.login}
            loading="lazy"
          />
        </Show>
        <span class="sidebar__row-counter">{`#${pr().number}`}</span>
        <span class="sidebar__branch-name">{pr().title}</span>
        <span
          class="sidebar__row-badge sidebar__row-badge--pr-state"
          data-state={badgeVariant(pr())}
        >
          {badgeLabel(pr())}
        </span>
        <span class="sidebar__row-meta">{relativeTime(pr().updatedAt)}</span>
        <button
          type="button"
          class="sidebar__pr-row__kebab"
          title="Pull request actions"
          aria-label="Pull request actions"
          onClick={openMenuFromButton}
        >
          ⋮
        </button>
      </div>
      <Show when={hasSecondaryContent(pr())}>
        <div class="sidebar__pr-row__secondary">
          <LabelChips labels={pr().labels} />
          <UserAvatarCluster users={pr().assignees} kind="assignees" />
          <UserAvatarCluster
            users={pr().requestedReviewers}
            kind="reviewers"
          />
          <ReviewBadge decision={pr().reviewDecision} />
          <CiBadge status={pr().ciStatus} />
        </div>
      </Show>
      <Show when={menuAt()}>
        {(anchor) => (
          <ContextMenu
            x={anchor().x}
            y={anchor().y}
            items={buildMenuItems(pr())}
            onClose={() => setMenuAt(null)}
          />
        )}
      </Show>
    </div>
  );
}
