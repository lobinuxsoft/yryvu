// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import type { PullRequestDetail } from "../../ipc";
import { LabelChips, UserAvatarCluster } from "../LeftSidebar/pullRequestChips";
import { Markdown } from "./markdownRender";

interface ConversationProps {
  detail: PullRequestDetail;
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

/// Conversation tab — markdown body on the left, metadata sidebar
/// on the right. Sidebar surfaces the chip clusters that already
/// render in the list row plus extras (milestone, branches,
/// created/updated timestamps, mergeability) that justify the panel.
export function Conversation(props: ConversationProps) {
  const detail = () => props.detail;
  return (
    <div class="pr-detail__conversation">
      <div class="pr-detail__conversation-main">
        <Show
          when={detail().body.trim().length > 0}
          fallback={
            <p class="pr-detail__empty">No description provided.</p>
          }
        >
          <Markdown source={detail().body} />
        </Show>
      </div>
      <aside class="pr-detail__conversation-sidebar">
        <SidebarSection title="Author">
          <div class="pr-detail__sidebar-author">
            <Show when={detail().author.avatarUrl}>
              <img
                class="pr-detail__sidebar-avatar"
                src={detail().author.avatarUrl}
                alt={detail().author.login}
                loading="lazy"
              />
            </Show>
            <span>{detail().author.login}</span>
          </div>
        </SidebarSection>
        <SidebarSection title="Branches">
          <div class="pr-detail__sidebar-branches">
            <code>{detail().headRef}</code>
            <span class="pr-detail__sidebar-arrow">→</span>
            <code>{detail().baseRef}</code>
          </div>
        </SidebarSection>
        <Show when={detail().labels.length > 0}>
          <SidebarSection title={`Labels (${detail().labels.length})`}>
            <LabelChips labels={detail().labels} max={detail().labels.length} />
          </SidebarSection>
        </Show>
        <Show when={detail().assignees.length > 0}>
          <SidebarSection title={`Assignees (${detail().assignees.length})`}>
            <For each={detail().assignees}>
              {(u) => (
                <div class="pr-detail__sidebar-user">
                  <Show when={u.avatarUrl}>
                    <img
                      class="pr-detail__sidebar-avatar"
                      src={u.avatarUrl}
                      alt={u.login}
                      loading="lazy"
                    />
                  </Show>
                  <span>{u.login}</span>
                </div>
              )}
            </For>
          </SidebarSection>
        </Show>
        <Show when={detail().requestedReviewers.length > 0}>
          <SidebarSection
            title={`Requested reviewers (${detail().requestedReviewers.length})`}
          >
            <UserAvatarCluster
              users={detail().requestedReviewers}
              kind="reviewers"
              max={detail().requestedReviewers.length}
            />
          </SidebarSection>
        </Show>
        <Show when={detail().milestone}>
          {(m) => (
            <SidebarSection title="Milestone">
              <span>{m()}</span>
            </SidebarSection>
          )}
        </Show>
        <SidebarSection title="Diff">
          <span class="pr-detail__sidebar-diff">
            <span class="pr-detail__diff-add">+{detail().additions}</span>
            {" "}
            <span class="pr-detail__diff-del">-{detail().deletions}</span>
            {" across "}
            {detail().changedFiles} file{detail().changedFiles === 1 ? "" : "s"}
          </span>
        </SidebarSection>
        <Show when={detail().mergeableState}>
          {(state) => (
            <SidebarSection title="Mergeability">
              <span data-state={state()} class="pr-detail__sidebar-mergeability">
                {state()}
              </span>
            </SidebarSection>
          )}
        </Show>
        <SidebarSection title="Timestamps">
          <div class="pr-detail__sidebar-times">
            <div>Opened {relativeTime(detail().createdAt)}</div>
            <div>Updated {relativeTime(detail().updatedAt)}</div>
            <Show when={detail().mergedAt}>
              {(m) => <div>Merged {relativeTime(m())}</div>}
            </Show>
            <Show when={!detail().mergedAt && detail().closedAt}>
              {(c) => <div>Closed {relativeTime(c())}</div>}
            </Show>
          </div>
        </SidebarSection>
      </aside>
    </div>
  );
}

function SidebarSection(props: { title: string; children: any }) {
  return (
    <section class="pr-detail__sidebar-section">
      <h4 class="pr-detail__sidebar-title">{props.title}</h4>
      <div class="pr-detail__sidebar-body">{props.children}</div>
    </section>
  );
}
