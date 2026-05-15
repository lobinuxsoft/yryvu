// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Match, Show, Switch } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { IssueDetail } from "../../ipc";
import {
  activeIssueDetail,
  closeIssueDetail,
  issueDetail,
} from "../../state/issue-detail";
import { LabelChips } from "../LeftSidebar/pullRequestChips";
import { Markdown } from "../PullRequestDetail/markdownRender";

/// Relative-time formatter matching the PR panel's helper.
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

interface SidebarSectionProps {
  title: string;
  children: any;
}

/// Reusable right-sidebar section block — mirror of the PR panel's
/// `Conversation` sidebar structure (GK `IssueTracker-*` layout).
function SidebarBlock(props: SidebarSectionProps) {
  return (
    <section class="issue-detail__sidebar-section">
      <h4 class="issue-detail__sidebar-title">{props.title}</h4>
      <div class="issue-detail__sidebar-body">{props.children}</div>
    </section>
  );
}

interface IssueBodyProps {
  detail: IssueDetail;
}

/// Issue detail panel — GK structure: main scrollable column on the
/// left (title + body markdown) + metadata sidebar on the right.
/// Theme tokens are yryvu's — colours, spacing, fonts come from the
/// existing CSS variables, not GK's palette.
function IssueBody(props: IssueBodyProps) {
  const detail = () => props.detail;
  return (
    <>
      <header class="issue-detail__header">
        <button
          type="button"
          class="issue-detail__back"
          title="Close detail view (back to graph)"
          onClick={closeIssueDetail}
        >
          ← Back
        </button>
        <div class="issue-detail__title-block">
          <span class="issue-detail__state-badge" data-state={detail().state}>
            {detail().state}
          </span>
          <h2 class="issue-detail__title">
            {detail().title}{" "}
            <span class="issue-detail__number">#{detail().number}</span>
          </h2>
        </div>
        <div class="issue-detail__header-actions">
          <button
            type="button"
            class="issue-detail__open-browser"
            onClick={() => {
              void openUrl(detail().htmlUrl);
            }}
            title="Open issue in browser"
          >
            Open in browser ↗
          </button>
        </div>
      </header>
      <div class="issue-detail__body">
        <main class="issue-detail__main">
          <Show
            when={detail().body.trim().length > 0}
            fallback={<p class="issue-detail__empty">No description provided.</p>}
          >
            <Markdown source={detail().body} />
          </Show>
        </main>
        <aside class="issue-detail__sidebar">
          <SidebarBlock title="Author">
            <div class="issue-detail__sidebar-author">
              <Show when={detail().author.avatarUrl}>
                <img
                  class="issue-detail__sidebar-avatar"
                  src={detail().author.avatarUrl}
                  alt={detail().author.login}
                  loading="lazy"
                />
              </Show>
              <span>{detail().author.login}</span>
            </div>
          </SidebarBlock>
          <Show when={detail().labels.length > 0}>
            <SidebarBlock title={`Labels (${detail().labels.length})`}>
              <LabelChips labels={detail().labels} max={detail().labels.length} />
            </SidebarBlock>
          </Show>
          <Show when={detail().assignees.length > 0}>
            <SidebarBlock title={`Assignees (${detail().assignees.length})`}>
              <For each={detail().assignees}>
                {(u) => (
                  <div class="issue-detail__sidebar-user">
                    <Show when={u.avatarUrl}>
                      <img
                        class="issue-detail__sidebar-avatar"
                        src={u.avatarUrl}
                        alt={u.login}
                        loading="lazy"
                      />
                    </Show>
                    <span>{u.login}</span>
                  </div>
                )}
              </For>
            </SidebarBlock>
          </Show>
          <Show when={detail().milestone}>
            {(m) => (
              <SidebarBlock title="Milestone">
                <span>{m()}</span>
              </SidebarBlock>
            )}
          </Show>
          <SidebarBlock title="Comments">
            <span>
              💬 {detail().comments} {detail().comments === 1 ? "comment" : "comments"}
            </span>
          </SidebarBlock>
          <SidebarBlock title="Timestamps">
            <div class="issue-detail__sidebar-times">
              <div>Opened {relativeTime(detail().createdAt)}</div>
              <div>Updated {relativeTime(detail().updatedAt)}</div>
              <Show when={detail().closedAt}>
                {(c) => <div>Closed {relativeTime(c())}</div>}
              </Show>
            </div>
          </SidebarBlock>
        </aside>
      </div>
    </>
  );
}

/// Top-level Issue detail panel — mounted in the central pane when
/// `mainView() === "issueDetail"`. Mirror of `PullRequestDetailPanel`
/// without the 4-tab strip (issues don't have commits/files/checks
/// surfaces).
export function IssueDetailPanel() {
  return (
    <div class="issue-detail">
      <Switch
        fallback={
          <Show
            when={issueDetail()}
            fallback={<div class="issue-detail__loading">Loading issue…</div>}
          >
            {(detail) => <IssueBody detail={detail()} />}
          </Show>
        }
      >
        <Match when={!activeIssueDetail()}>
          <div class="issue-detail__loading">No issue selected.</div>
        </Match>
        <Match when={issueDetail.error}>
          {(err) => (
            <div class="issue-detail__error">
              <p>Failed to load issue: {String(err())}</p>
              <button
                type="button"
                class="issue-detail__back"
                onClick={closeIssueDetail}
              >
                ← Back to graph
              </button>
            </div>
          )}
        </Match>
      </Switch>
    </div>
  );
}
