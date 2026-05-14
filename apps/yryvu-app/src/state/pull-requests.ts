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
 * - `unsupported-provider` — repo is on a provider we don't yet
 *   support a panel for (Bitbucket / Azure / etc). GitHub (#15/#360),
 *   GitLab (#16) and Gitea / Forgejo (#17) are supported.
 * - `bare-or-unparseable` — bare repo, zero-remote, or origin URL
 *   that doesn't split into `(owner, repo)`.
 * - `not-connected` — supported provider but the integration isn't
 *   configured; the panel renders the inline-connect CTA.
 * - `error` — backend call failed; surface the detail for the toast.
 */
export type PullRequestsResult =
  | { kind: "ready"; prs: PullRequestSummary[] }
  | { kind: "no-repo" }
  | { kind: "unsupported-provider"; service: HostingService }
  | { kind: "bare-or-unparseable" }
  | { kind: "not-connected" }
  | { kind: "error"; detail: string };

/// Hosting services with a PR/MR list-panel backend implemented.
/// Extend when new per-provider clients land.
const SUPPORTED_SERVICES: ReadonlyArray<HostingService> = ["github", "gitlab", "gitea"];

/// Map a yryvu HostingService to the keyring integration_type used by
/// the connected-state check. For github/gitlab the names happen to
/// match; if a future provider needs translation, fold it here.
function integrationTypeFor(service: HostingService): string {
  return service;
}

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

/// Active integration metadata so consumers (kebab menu / row click)
/// can open the PR detail panel without re-fetching the provider info.
/// Updated by `fetchPullRequests` on every successful classification.
const [activePrContext, setActivePrContext] = createSignal<
  { integrationType: string; owner: string; repo: string } | null
>(null);

export { activePrContext };

async function fetchPullRequests(source: PrSourceKey): Promise<PullRequestsResult> {
  let info: RepoProviderInfo;
  try {
    info = await getRepoProviderInfo(source.path);
  } catch (err) {
    setActivePrContext(null);
    return { kind: "error", detail: String(err) };
  }
  if (!SUPPORTED_SERVICES.includes(info.service)) {
    setActivePrContext(null);
    return { kind: "unsupported-provider", service: info.service };
  }
  if (!info.owner || !info.repo) {
    setActivePrContext(null);
    return { kind: "bare-or-unparseable" };
  }
  const integrationType = integrationTypeFor(info.service);
  setActivePrContext({ integrationType, owner: info.owner, repo: info.repo });
  let configured: string[];
  try {
    configured = await listConfiguredIntegrations();
  } catch (err) {
    return { kind: "error", detail: String(err) };
  }
  if (!configured.includes(integrationType)) {
    return { kind: "not-connected" };
  }
  const dsl = buildDsl(source.filter, source.sort);
  try {
    const prs = await integrationListPrs(
      integrationType,
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
