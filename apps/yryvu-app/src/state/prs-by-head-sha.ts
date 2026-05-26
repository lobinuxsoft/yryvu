// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Memoized PR-by-head-SHA lookup driving the commit-graph PR
 * attribution overlay (issue #53). Resolves the `pullRequests`
 * resource down to a `Map<sha, PullRequestSummary>` so the per-row
 * renderer can do O(1) lookups without re-walking the full PR list
 * per commit.
 *
 * Returns `undefined` when the PR resource is in any non-ready state
 * (loading / unsupported provider / not connected / error) — the
 * overlay just skips rendering in those cases.
 */

import { createMemo } from "solid-js";

import type { PullRequestSummary } from "../ipc";

import { pullRequests } from "./pull-requests";

export const prsByHeadSha = createMemo<Map<string, PullRequestSummary> | undefined>(
  () => {
    const result = pullRequests();
    if (!result || result.kind !== "ready") return undefined;
    const out = new Map<string, PullRequestSummary>();
    for (const pr of result.prs) {
      if (pr.headSha) out.set(pr.headSha, pr);
    }
    return out;
  },
);
