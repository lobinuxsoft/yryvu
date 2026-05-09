// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show, type JSX } from "solid-js";

interface PlaceholderProps {
  section: string;
  issue?: number;
}

const REPO_URL = "https://github.com/lobinuxsoft/yryvu";

export function Placeholder(props: PlaceholderProps): JSX.Element {
  return (
    <div class="preferences-placeholder">
      <h3 class="preferences-placeholder__title">Not yet implemented</h3>
      <p class="preferences-placeholder__body">
        The <strong>{props.section}</strong> preferences panel will land in a
        dedicated PR. The shell already routes here so the section is wired
        up the moment the panel ships.
      </p>
      <Show when={props.issue}>
        <p class="preferences-placeholder__body">
          Tracked in{" "}
          <a
            class="preferences-placeholder__link"
            href={`${REPO_URL}/issues/${props.issue}`}
            target="_blank"
            rel="noreferrer"
          >
            #{props.issue}
          </a>
          .
        </p>
      </Show>
    </div>
  );
}
