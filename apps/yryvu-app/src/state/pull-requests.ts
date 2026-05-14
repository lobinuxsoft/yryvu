// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal } from "solid-js";

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

/**
 * Sort options surfaced in the toolbar. `newest` (the GitHub default)
 * maps to "no sort token" — the REST `/pulls` endpoint already
 * returns newest-first.
 */
export type PrSortKey =
  | "newest"
  | "oldest"
  | "most_updated"
  | "most_commented";

const [prFilterDsl, setPrFilterDsl] = createSignal<string>("");
const [prSort, setPrSort] = createSignal<PrSortKey>("newest");

export { prFilterDsl, setPrFilterDsl, prSort, setPrSort };

/// Translate the toolbar sort selection into a GitHub search `sort:`
/// token. `newest` returns `""` (no token); the REST default already
/// orders by creation date desc, so omitting the token keeps us on
/// the cheaper REST path when the filter is also empty.
function sortToken(sort: PrSortKey): string {
  switch (sort) {
    case "newest":
      return "";
    case "oldest":
      return "sort:created-asc";
    case "most_updated":
      return "sort:updated-desc";
    case "most_commented":
      return "sort:comments-desc";
  }
}

/// Compose the toolbar's freeform filter text + sort selection into a
/// single DSL string ready for `integrationListPrs`. Empty string =
/// take the REST list path; non-empty = take the GraphQL search path.
function buildDsl(filter: string, sort: PrSortKey): string {
  const trimmed = filter.trim();
  const token = sortToken(sort);
  if (!trimmed && !token) return "";
  if (!trimmed) return token;
  if (!token) return trimmed;
  return `${trimmed} ${token}`;
}

interface PrSourceKey {
  path: string;
  filter: string;
  sort: PrSortKey;
}

async function fetchPullRequests(source: PrSourceKey): Promise<PullRequestsResult> {
  let info: RepoProviderInfo;
  try {
    info = await getRepoProviderInfo(source.path);
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
  const dsl = buildDsl(source.filter, source.sort);
  try {
    const prs = await integrationListPrs(
      "github",
      info.owner,
      info.repo,
      dsl || undefined,
    );
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
 * Pull-request list resource — keyed on the tuple
 * `(repoPath, filter, sort)`. Refetches when the user opens a
 * different repo OR mutates the filter / sort. Returns the
 * discriminated [`PullRequestsResult`] so the panel can pick the
 * right empty state without re-running provider classification.
 */
export const [pullRequests, { refetch: refetchPullRequests }] = createResource<
  PullRequestsResult,
  PrSourceKey
>(
  () => {
    const path = repoPath();
    return path
      ? { path, filter: prFilterDsl(), sort: prSort() }
      : (undefined as unknown as PrSourceKey);
  },
  fetchPullRequests,
);
