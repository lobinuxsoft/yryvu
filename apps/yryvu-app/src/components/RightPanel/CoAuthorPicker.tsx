// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal, For, Show, type JSX } from "solid-js";

import { recentAuthors, type AuthorInfo } from "../../ipc";

export interface CoAuthorPickerProps {
  /// Repo path the picker reads recent authors from. Empty string
  /// short-circuits the resource so the picker stays disabled until a
  /// repo is loaded.
  repoPath: string;
  /// Current commit description. The picker appends a
  /// `Co-authored-by:` line to this value and hands the result back
  /// via `onChange`.
  description: string;
  onChange: (next: string) => void;
}

/// Format the Git Co-authored-by trailer that GitHub recognises as
/// granting credit to the named user. Trailing whitespace is trimmed.
function trailer(author: AuthorInfo): string {
  return `Co-authored-by: ${author.name.trim()} <${author.email.trim()}>`;
}

/// Append `line` to `body`, idempotent: returns `body` unchanged if it
/// already contains the line (case-insensitive). Ensures the trailer
/// block is separated from the body by a blank line per Git convention.
function appendTrailer(body: string, line: string): string {
  const normalised = body.replace(/\s+$/, "");
  if (normalised.toLowerCase().includes(line.toLowerCase())) {
    return body;
  }
  if (normalised.length === 0) {
    return line;
  }
  // Detect whether the current body already has a trailer block (lines
  // matching `Key: value`). If so, append directly; otherwise add the
  // separating blank line.
  const lastBlock = normalised.split(/\n\s*\n/).pop() ?? "";
  const isTrailerBlock = lastBlock
    .split("\n")
    .every((l) => /^[A-Z][A-Za-z-]+:\s/.test(l));
  return isTrailerBlock
    ? `${normalised}\n${line}`
    : `${normalised}\n\n${line}`;
}

export function CoAuthorPicker(props: CoAuthorPickerProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [authors] = createResource<AuthorInfo[], string>(
    () => props.repoPath,
    async (p) => {
      if (!p) return [];
      try {
        return await recentAuthors(p);
      } catch (err) {
        console.error("recent_authors failed", err);
        return [];
      }
    },
  );

  function addAuthor(author: AuthorInfo) {
    props.onChange(appendTrailer(props.description, trailer(author)));
    setOpen(false);
  }

  return (
    <div class="co-author-picker">
      <button
        type="button"
        class="co-author-picker__toggle"
        aria-expanded={open()}
        disabled={!props.repoPath || (authors() ?? []).length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        + Add Co-Author
      </button>
      <Show when={open()}>
        <ul class="co-author-picker__list" role="menu">
          <For
            each={authors() ?? []}
            fallback={
              <li class="co-author-picker__empty">No recent authors</li>
            }
          >
            {(author) => (
              <li class="co-author-picker__item" role="none">
                <button
                  type="button"
                  role="menuitem"
                  class="co-author-picker__row"
                  onClick={() => addAuthor(author)}
                >
                  <span class="co-author-picker__name">{author.name}</span>
                  <span class="co-author-picker__email">{author.email}</span>
                  <span class="co-author-picker__count">×{author.count}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
