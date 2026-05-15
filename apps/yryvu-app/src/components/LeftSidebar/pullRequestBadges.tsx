// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import type { CiStatus, ReviewDecision } from "../../ipc";
import { Tooltip } from "../Tooltip";

const REVIEW_LABELS: Record<ReviewDecision, string> = {
  approved: "approved",
  changes_requested: "changes requested",
  review_required: "review required",
};

const CI_LABELS: Record<CiStatus, string> = {
  success: "passing",
  failure: "failing",
  pending: "pending",
  error: "error",
  expected: "expected",
};

interface ReviewBadgeProps {
  decision: ReviewDecision | null;
}

export function ReviewBadge(props: ReviewBadgeProps) {
  return (
    <Show when={props.decision}>
      {(d) => (
        <Tooltip text={`Review: ${REVIEW_LABELS[d()]}`}>
          <span
            class="sidebar__row-badge sidebar__pr-review-badge"
            data-state={d()}
          >
            {REVIEW_LABELS[d()]}
          </span>
        </Tooltip>
      )}
    </Show>
  );
}

interface CiBadgeProps {
  status: CiStatus | null;
}

export function CiBadge(props: CiBadgeProps) {
  return (
    <Show when={props.status}>
      {(s) => (
        <Tooltip text={`CI: ${CI_LABELS[s()]}`}>
          <span
            class="sidebar__row-badge sidebar__pr-ci-badge"
            data-state={s()}
          >
            {CI_LABELS[s()]}
          </span>
        </Tooltip>
      )}
    </Show>
  );
}
