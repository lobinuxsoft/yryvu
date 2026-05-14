// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { CheckRun } from "../../ipc";

interface ChecksProps {
  checks: CheckRun[];
}

/// Surface label for a check run — combines `status` and `conclusion`
/// into a single human-readable verb. Completed runs surface their
/// conclusion; in-flight ones surface the status.
function checkLabel(c: CheckRun): string {
  if (c.status === "completed") {
    return c.conclusion ?? "completed";
  }
  return c.status;
}

/// `data-state` value for CSS — maps the surface label into the
/// limited palette the badge styles know about. Mirrors the row
/// CiBadge mapping so colours are consistent across the panel + list.
function checkVariant(c: CheckRun): string {
  if (c.status !== "completed") {
    // queued / in_progress → pending
    return "pending";
  }
  switch (c.conclusion) {
    case "success":
      return "success";
    case "failure":
    case "timed_out":
    case "action_required":
      return "failure";
    case "neutral":
    case "skipped":
      return "skipped";
    case "cancelled":
      return "cancelled";
    default:
      return "neutral";
  }
}

export function Checks(props: ChecksProps) {
  return (
    <Show
      when={props.checks.length > 0}
      fallback={
        <p class="pr-detail__empty">
          No CI checks reported on the head commit.
        </p>
      }
    >
      <ul class="pr-detail__checks">
        <For each={props.checks}>
          {(c) => (
            <li class="pr-detail__check-row">
              <span
                class="pr-detail__check-state"
                data-state={checkVariant(c)}
              >
                {checkLabel(c)}
              </span>
              <span class="pr-detail__check-name">{c.name}</span>
              <Show when={c.detailsUrl}>
                {(url) => (
                  <button
                    type="button"
                    class="pr-detail__check-link"
                    onClick={() => {
                      void openUrl(url());
                    }}
                  >
                    Details ↗
                  </button>
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
