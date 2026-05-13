// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show, type JSX } from "solid-js";

import {
  linkifyIssueRefs,
  type LinkifiedSegment,
} from "../../../lib/linkify-issues";
import {
  issueLinkifyEnabled,
  issueTrackerPattern,
} from "../../../state/issue-tracker";
import { emojify } from "./emojify";

function renderSegments(segments: LinkifiedSegment[]): JSX.Element {
  return (
    <For each={segments}>
      {(segment) =>
        segment.kind === "link" ? (
          <a
            class="issue-ref-link"
            href={segment.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {segment.text}
          </a>
        ) : (
          segment.value
        )
      }
    </For>
  );
}

/**
 * Commit message block: subject in a `<p>`, body in a `<pre>` with
 * `word-break: break-word` so long lines wrap inside the panel without
 * pushing horizontal scroll.
 *
 * Two text transforms run in order:
 *
 * 1. `emojify(...)` — replace `:shortcode:` tokens with the unicode
 *    character. 1:1 with GitKraken's bundle (verified 2026-04-23).
 * 2. `linkifyIssueRefs(...)` — rewrite `#NN` refs as `<a>` tags using
 *    the resolved URL pattern for the active repo (issue #306). yryvu
 *    deviation from GK — GK ships this only behind the Jira / GitHub
 *    deep-integration paid path; we ship it for everyone via the
 *    pattern preference.
 *
 * The linkifier returns plain segments; the JSX construction lives
 * here so the helper stays DOM-free and unit-testable in node.
 *
 * `data-testid` attributes mirror the bundle's for future E2E parity
 * with GitKraken's own tests (should we ever port them).
 */
export function MessageBlock(props: { summary: string; body: string }) {
  const linkify = (text: string) =>
    linkifyIssueRefs(emojify(text), issueTrackerPattern() ?? null, issueLinkifyEnabled());

  return (
    <div class="commit-detail__message">
      <p data-testid="commit-message-summary" class="commit-detail__summary">
        {renderSegments(linkify(props.summary))}
      </p>
      <Show when={props.body.length > 0}>
        <pre
          data-testid="commit-message-description"
          class="commit-detail__body"
        >
          {renderSegments(linkify(props.body))}
        </pre>
      </Show>
    </div>
  );
}
