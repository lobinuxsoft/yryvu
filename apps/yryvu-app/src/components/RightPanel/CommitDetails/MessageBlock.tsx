// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { emojify } from "./emojify";

/**
 * Commit message block: subject in a `<p>`, body in a `<pre>` with
 * `word-break: break-word` so long lines wrap inside the panel without
 * pushing horizontal scroll. 1:1 with the GitKraken bundle — the only
 * text transform is `emojify(...)` (verified 2026-04-23). No markdown,
 * no linkify, no issue-ref rewriting.
 *
 * `data-testid` attributes mirror the bundle's for future E2E parity
 * with GitKraken's own tests (should we ever port them).
 */
export function MessageBlock(props: { summary: string; body: string }) {
  return (
    <div class="commit-detail__message">
      <p data-testid="commit-message-summary" class="commit-detail__summary">
        {emojify(props.summary)}
      </p>
      <Show when={props.body.length > 0}>
        <pre
          data-testid="commit-message-description"
          class="commit-detail__body"
        >
          {emojify(props.body)}
        </pre>
      </Show>
    </div>
  );
}
