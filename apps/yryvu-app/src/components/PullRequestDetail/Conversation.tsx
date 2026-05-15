// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import type { PullRequestDetail } from "../../ipc";
import { Markdown } from "./markdownRender";

interface ConversationProps {
  detail: PullRequestDetail;
}

/// Description body — renders the PR's markdown description. The
/// metadata sidebar lives one level up (see `MetadataSidebar.tsx`)
/// so it stays pinned alongside every section of the panel.
export function Conversation(props: ConversationProps) {
  const detail = () => props.detail;
  return (
    <Show
      when={detail().body.trim().length > 0}
      fallback={<p class="pr-detail__empty">No description provided.</p>}
    >
      <Markdown source={detail().body} />
    </Show>
  );
}
