// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import type { PullRequestDetail } from "../../ipc";
import { LabelChips, UserAvatarCluster } from "../LeftSidebar/pullRequestChips";

interface SidebarBlockProps {
  title: string;
  children: any;
}

/// Reusable sidebar block — title row + body slot. The styling
/// matches GK's metadata-card pattern but with yryvu theme tokens.
function SidebarBlock(props: SidebarBlockProps) {
  return (
    <section class="pr-detail__sidebar-section">
      <h4 class="pr-detail__sidebar-title">{props.title}</h4>
      <div class="pr-detail__sidebar-body">{props.children}</div>
    </section>
  );
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

interface MetadataSidebarProps {
  detail: PullRequestDetail;
}

/// Right-hand metadata sidebar — mirror of GK's PR detail sidebar
/// (Author / Branches / Labels / Assignees / Reviewers / Milestone /
/// Diff stats / Mergeability / Timestamps). Theme tokens are yryvu's.
export function MetadataSidebar(props: MetadataSidebarProps) {
  const detail = () => props.detail;
  return (
    <aside class="pr-detail__sidebar">
      <SidebarBlock title="Author">
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
      </SidebarBlock>
      <SidebarBlock title="Branches">
        <div class="pr-detail__sidebar-branches">
          <code>{detail().headRef}</code>
          <span class="pr-detail__sidebar-arrow">→</span>
          <code>{detail().baseRef}</code>
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
        </SidebarBlock>
      </Show>
      <Show when={detail().requestedReviewers.length > 0}>
        <SidebarBlock
          title={`Requested reviewers (${detail().requestedReviewers.length})`}
        >
          <UserAvatarCluster
            users={detail().requestedReviewers}
            kind="reviewers"
            max={detail().requestedReviewers.length}
          />
        </SidebarBlock>
      </Show>
      <Show when={detail().milestone}>
        {(m) => (
          <SidebarBlock title="Milestone">
            <span>{m()}</span>
          </SidebarBlock>
        )}
      </Show>
      <SidebarBlock title="Diff">
        <span class="pr-detail__sidebar-diff">
          <span class="pr-detail__diff-add">+{detail().additions}</span>{" "}
          <span class="pr-detail__diff-del">-{detail().deletions}</span>
          {" across "}
          {detail().changedFiles} file{detail().changedFiles === 1 ? "" : "s"}
        </span>
      </SidebarBlock>
      <Show when={detail().mergeableState}>
        {(state) => (
          <SidebarBlock title="Mergeability">
            <span
              data-state={state()}
              class="pr-detail__sidebar-mergeability"
            >
              {state()}
            </span>
          </SidebarBlock>
        )}
      </Show>
      <SidebarBlock title="Timestamps">
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
      </SidebarBlock>
    </aside>
  );
}
