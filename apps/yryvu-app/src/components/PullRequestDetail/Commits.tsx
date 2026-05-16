// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import type { PrCommit } from "../../ipc";
import { setSelectedCommit } from "../../state";
import { closePrDetail } from "../../state/pr-detail";
import { Tooltip } from "../Tooltip";

interface CommitsProps {
  commits: PrCommit[];
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

/// First line of a commit message. Multi-line subjects are unusual
/// (Conventional Commits encourages one-line subjects); the rest
/// becomes the body, which we don't surface here.
function firstLine(message: string): string {
  const nl = message.indexOf("\n");
  return nl > 0 ? message.slice(0, nl) : message;
}

export function Commits(props: CommitsProps) {
  return (
    <Show
      when={props.commits.length > 0}
      fallback={<p class="pr-detail__empty">No commits in this PR.</p>}
    >
      <ul class="pr-detail__commits">
        <For each={props.commits}>
          {(c) => (
            <li class="pr-detail__commit-row">
              <Tooltip text={`${c.sha}\n\n${c.message}`}>
              <button
                type="button"
                class="pr-detail__commit-button"
                onClick={() => {
                  setSelectedCommit(c.sha);
                  closePrDetail();
                }}
              >
                <code class="pr-detail__commit-sha">{c.shortSha}</code>
                <span class="pr-detail__commit-subject">{firstLine(c.message)}</span>
                <Show when={c.author.avatarUrl}>
                  <img
                    class="pr-detail__commit-avatar"
                    src={c.author.avatarUrl}
                    alt={c.author.login}
                    loading="lazy"
                  />
                </Show>
                <span class="pr-detail__commit-author">{c.author.login}</span>
                <span class="pr-detail__commit-time">{relativeTime(c.date)}</span>
              </button>
              </Tooltip>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
