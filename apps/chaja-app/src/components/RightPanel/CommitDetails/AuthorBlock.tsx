// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, For, Show } from "solid-js";

import type { CommitDetail, HostingService } from "../../../ipc";
import { InspectorAvatar } from "./InspectorAvatar";

/**
 * Author / committer / co-authors block for the inspector, per
 * `docs/research/gitkraken-right-panel/04-author-committer-block.md`.
 *
 * Committer block visibility follows the bundle's **double guard**
 * (verified against the GK bundle 2026-04-23):
 *
 *     !committerInfo || (email === authorEmail && name === authorName)
 *
 * i.e. no render when committer is absent (malformed commit) OR when
 * committer matches author exactly. The initial research (`doc 04`) only
 * captured the second half.
 *
 * Date format is absolute locale (`L @ LT`), not relative — the relative
 * form lives in the graph rows / multi-select cards, not the inspector.
 */

interface CoAuthor {
  name: string;
  email: string;
  initials: string;
}

// Match GitKraken's trailer regex for Co-Authored-By. Case-insensitive,
// multi-line (`^` per line), global.
const CO_AUTHOR_RE =
  /^co-authored-by:\s*([^\s<>][^<>]*?)\s*<([^<>]+)>\s*$/gim;

function extractCoAuthors(body: string): CoAuthor[] {
  const out: CoAuthor[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(CO_AUTHOR_RE)) {
    const name = match[1]?.trim() ?? "";
    const email = match[2]?.trim() ?? "";
    const key = `${name.toLowerCase()}|${email.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, email, initials: authorInitials(name, email) });
  }
  return out;
}

/**
 * Two-letter initials for co-authors, since the backend only pre-computes
 * them for the author/committer. Matches `graph_core::author_initials`.
 */
function authorInitials(name: string, email: string): string {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    const local = email.split("@")[0] ?? "";
    return (local[0] ?? "?").toUpperCase();
  }
  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  const first = tokens[0][0] ?? "";
  const last = tokens[tokens.length - 1][0] ?? "";
  return `${first}${last}`.toUpperCase();
}

function formatDateTime(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  // Locale-aware absolute form `L @ LT` — in the user's locale the
  // separator mark makes the two parts read as "<date> at <time>".
  return `${d.toLocaleDateString()} @ ${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function hasDistinctCommitter(detail: CommitDetail): boolean {
  if (
    detail.committer_name === null ||
    detail.committer_email === null ||
    detail.committer_date === null
  ) {
    return false;
  }
  return (
    detail.committer_name !== detail.author_name ||
    detail.committer_email !== detail.author_email
  );
}

export function AuthorBlock(props: {
  detail: CommitDetail;
  hostingService: HostingService;
}) {
  const coAuthors = createMemo(() => extractCoAuthors(props.detail.body));
  const committerVisible = createMemo(() => hasDistinctCommitter(props.detail));

  return (
    <div class="commit-detail__people">
      <div class="commit-detail__person">
        <InspectorAvatar
          email={props.detail.author_email}
          initials={props.detail.author_initials}
          gravatarHash={props.detail.gravatar_hash}
          hostingService={props.hostingService}
          size={40}
        />
        <div class="commit-detail__person-text">
          <span class="commit-detail__person-name" title={props.detail.author_email}>
            {props.detail.author_name}
          </span>
          <span class="commit-detail__person-meta">
            <span class="commit-detail__person-verb">authored</span>
            <span class="commit-detail__person-date">
              {formatDateTime(props.detail.author_date)}
            </span>
          </span>
        </div>
      </div>

      <Show when={committerVisible()}>
        <div class="commit-detail__person">
          <InspectorAvatar
            email={props.detail.committer_email!}
            initials={props.detail.committer_initials!}
            gravatarHash={props.detail.committer_gravatar_hash!}
            hostingService={props.hostingService}
            size={40}
          />
          <div class="commit-detail__person-text">
            <span
              class="commit-detail__person-name"
              title={props.detail.committer_email!}
            >
              {props.detail.committer_name!}
            </span>
            <span class="commit-detail__person-meta">
              <span class="commit-detail__person-verb">committed</span>
              <span class="commit-detail__person-date">
                {formatDateTime(props.detail.committer_date!)}
              </span>
            </span>
          </div>
        </div>
      </Show>

      <Show when={coAuthors().length > 0}>
        <div class="commit-detail__coauthors">
          <span class="commit-detail__coauthors-label">co-authors</span>
          <ul class="commit-detail__coauthors-list">
            <For each={coAuthors()}>
              {(c) => (
                <li
                  class="commit-detail__coauthor"
                  title={`${c.name} <${c.email}>`}
                >
                  <span class="inspector-avatar inspector-avatar--20">
                    <span class="inspector-avatar__initials">{c.initials}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
}
