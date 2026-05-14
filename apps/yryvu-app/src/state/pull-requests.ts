// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource } from "solid-js";

import {
  getRepoProviderInfo,
  integrationListPrs,
  listConfiguredIntegrations,
  type HostingService,
  type PullRequestSummary,
  type RepoProviderInfo,
} from "../ipc";
import { repoPath } from "./repo-base";

/**
 * Discriminated union returned by the PR resource so the panel can
 * render the right empty state without re-running classification.
 *
 * - `ready` — happy path, render the list (may still be empty).
 * - `no-repo` — no repo is open.
 * - `not-github` — repo is on a non-GitHub provider; PR list panel
 *   is GitHub-only in walking-skeleton v1. GitLab / Gitea / Bitbucket
 *   wave in via #16 / #17.
 * - `bare-or-unparseable` — bare repo, zero-remote, or origin URL
 *   that doesn't split into `(owner, repo)`.
 * - `not-connected` — GitHub repo but the integration isn't
 *   configured; the panel renders the inline-connect CTA.
 * - `error` — backend call failed; surface the detail for the toast.
 */
export type PullRequestsResult =
  | { kind: "ready"; prs: PullRequestSummary[] }
  | { kind: "no-repo" }
  | { kind: "not-github"; service: HostingService }
  | { kind: "bare-or-unparseable" }
  | { kind: "not-connected" }
  | { kind: "error"; detail: string };

async function fetchPullRequests(path: string): Promise<PullRequestsResult> {
  let info: RepoProviderInfo;
  try {
    info = await getRepoProviderInfo(path);
  } catch (err) {
    return { kind: "error", detail: String(err) };
  }
  if (info.service !== "github") {
    return { kind: "not-github", service: info.service };
  }
  if (!info.owner || !info.repo) {
    return { kind: "bare-or-unparseable" };
  }
  let configured: string[];
  try {
    configured = await listConfiguredIntegrations();
  } catch (err) {
    return { kind: "error", detail: String(err) };
  }
  if (!configured.includes("github")) {
    return { kind: "not-connected" };
  }
  try {
    const prs = await integrationListPrs("github", info.owner, info.repo);
    return { kind: "ready", prs };
  } catch (err) {
    const detail = String(err);
    // "is not connected" should never reach here (we just checked
    // configured), but if the keyring entry is stale while the sidecar
    // still says configured, treat it as not-connected to surface the
    // CTA instead of a noisy toast.
    if (detail.includes("is not connected")) {
      return { kind: "not-connected" };
    }
    return { kind: "error", detail };
  }
}

/**
 * Pull-request list resource — keyed on `repoPath()`. Refetches when
 * the user opens a different repo. Returns the discriminated
 * [`PullRequestsResult`] so the panel can pick the right empty state
 * without re-running provider classification.
 *
 * Walking-skeleton scope for #15: REST-only, no filters / sort /
 * pagination / refresh-on-focus. Wave 2 adds refetch triggers (focus,
 * post-push hooks, manual refresh button).
 */
export const [pullRequests, { refetch: refetchPullRequests }] = createResource<
  PullRequestsResult,
  string
>(
  () => repoPath(),
  fetchPullRequests,
);
