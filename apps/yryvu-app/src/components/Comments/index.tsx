// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal, For, Show } from "solid-js";

import type { Comment, CommentTarget } from "../../ipc";
import { integrationCreateComment, integrationListComments } from "../../ipc";
import { MarkdownEditor } from "../MarkdownEditor";
import { Markdown } from "../PullRequestDetail/markdownRender";

interface CommentsContext {
  integrationType: string;
  owner: string;
  repo: string;
  target: CommentTarget;
  number: number;
}

interface CommentsProps {
  /// Returns the fetch context when the parent is ready. Null
  /// means "no active ref" — the panel renders an empty state.
  contextAccessor: () => CommentsContext | null;
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

/// Comments thread + new-comment composer. Mirrors GK's discussion
/// surface: stacked comment cards above an inline MarkdownEditor +
/// Comment button. Refetches when context changes (different
/// issue/PR navigated to).
export function Comments(props: CommentsProps) {
  const [draft, setDraft] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const [comments, { refetch }] = createResource<Comment[], CommentsContext>(
    () => props.contextAccessor() ?? null,
    async (ctx) => {
      if (!ctx) return [];
      try {
        return await integrationListComments(
          ctx.integrationType,
          ctx.owner,
          ctx.repo,
          ctx.target,
          ctx.number,
        );
      } catch (err) {
        setError(String(err));
        return [];
      }
    },
    { initialValue: [] },
  );

  async function postComment() {
    const ctx = props.contextAccessor();
    if (!ctx) return;
    const body = draft().trim();
    if (body.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await integrationCreateComment(
        ctx.integrationType,
        ctx.owner,
        ctx.repo,
        ctx.target,
        ctx.number,
        body,
      );
      setDraft("");
      refetch();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="comments">
      <Show
        when={comments() && comments()!.length > 0}
        fallback={
          <Show when={!comments.loading}>
            <p class="comments__empty">No comments yet.</p>
          </Show>
        }
      >
        <ol class="comments__list">
          <For each={comments()}>{(c) => <CommentCard comment={c} />}</For>
        </ol>
      </Show>

      <div class="comments__composer">
        <h4 class="comments__composer-title">Add a comment</h4>
        <MarkdownEditor
          value={draft()}
          onInput={setDraft}
          placeholder="Leave a comment…"
          rows={5}
          disabled={submitting()}
        />
        <div class="comments__composer-actions">
          <Show when={error()}>
            {(err) => <span class="comments__composer-error">{err()}</span>}
          </Show>
          <button
            type="button"
            class="comments__composer-submit"
            disabled={submitting() || draft().trim().length === 0}
            onClick={() => void postComment()}
          >
            {submitting() ? "Posting…" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentCard(props: { comment: Comment }) {
  const c = () => props.comment;
  return (
    <li class="comments__card">
      <header class="comments__card-header">
        <Show when={c().author.avatarUrl}>
          <img
            class="comments__card-avatar"
            src={c().author.avatarUrl}
            alt={c().author.login}
            loading="lazy"
          />
        </Show>
        <span class="comments__card-author">{c().author.login}</span>
        <span class="comments__card-time">
          commented {relativeTime(c().createdAt)}
        </span>
      </header>
      <div class="comments__card-body">
        <Show
          when={c().body.trim().length > 0}
          fallback={<p class="comments__empty">No body.</p>}
        >
          <Markdown source={c().body} />
        </Show>
      </div>
    </li>
  );
}
