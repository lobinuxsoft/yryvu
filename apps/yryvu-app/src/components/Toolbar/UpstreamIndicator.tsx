// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

/**
 * Display-only ahead/behind indicator for HEAD's upstream. Mounted next
 * to the branch selector in the toolbar; hidden when the active branch
 * has no upstream or when both counts are zero.
 *
 * Anatomy mirrors GitKraken's `UpstreamIndicator`
 * (`/tmp/gk-bundle-pretty.js:156887-156908`): two pills with
 * up/down arrows, each capped at `99+`. No click handlers — the user
 * acts on the dedicated Pull / Push buttons next to it.
 */
interface UpstreamIndicatorProps {
  ahead: number;
  behind: number;
  /** Upstream short name (e.g. `origin/main`) shown in the tooltip. */
  upstreamShort?: string;
}

function cap(n: number): string {
  return n >= 100 ? "99+" : String(n);
}

function tooltipFor(ahead: number, behind: number, upstream?: string): string {
  const ref = upstream ?? "upstream";
  if (ahead > 0 && behind > 0) {
    return `${behind} commit${behind === 1 ? "" : "s"} behind and ${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${ref}`;
  }
  if (behind > 0) {
    return `${behind} commit${behind === 1 ? "" : "s"} behind ${ref}\nClick Pull to fetch and merge`;
  }
  return `${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${ref}\nClick Push to publish`;
}

export function UpstreamIndicator(props: UpstreamIndicatorProps) {
  const visible = () => props.ahead > 0 || props.behind > 0;

  return (
    <Show when={visible()}>
      <div
        class="upstream-indicator"
        title={tooltipFor(props.ahead, props.behind, props.upstreamShort)}
      >
        <Show when={props.behind > 0}>
          <span class="upstream-indicator__pill upstream-indicator__pill--behind" data-testid="behind">
            <span class="upstream-indicator__count">{cap(props.behind)}</span>
            <svg
              viewBox="0 0 16 16"
              width="9"
              height="9"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 2.5v11" />
              <path d="M3.5 9.5L8 14l4.5-4.5" />
            </svg>
          </span>
        </Show>
        <Show when={props.ahead > 0}>
          <span class="upstream-indicator__pill upstream-indicator__pill--ahead" data-testid="ahead">
            <span class="upstream-indicator__count">{cap(props.ahead)}</span>
            <svg
              viewBox="0 0 16 16"
              width="9"
              height="9"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 13.5v-11" />
              <path d="M3.5 6.5L8 2l4.5 4.5" />
            </svg>
          </span>
        </Show>
      </div>
    </Show>
  );
}
