// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal } from "solid-js";

import {
  getRepoProviderInfo,
  integrationListIssues,
  listConfiguredIntegrations,
  type HostingService,
  type IssueSummary,
  type RepoProviderInfo,
} from "../ipc";
import { repoPath } from "./repo-base";

/// Discriminated union returned by the issues resource — same shape
/// language as [`PullRequestsResult`] in `state/pull-requests.ts`,
/// kept apart so the panels can render independently and refetch on
/// different cadences.
export type IssuesResult =
  | { kind: "ready"; issues: IssueSummary[] }
  | { kind: "no-repo" }
  | { kind: "unsupported-provider"; service: HostingService }
  | { kind: "bare-or-unparseable" }
  | { kind: "not-connected" }
  | { kind: "error"; detail: string };

const SUPPORTED_SERVICES: ReadonlyArray<HostingService> = ["github", "gitlab", "gitea"];

function integrationTypeFor(service: HostingService): string {
  return service;
}

/// Active integration metadata so the row click can open the issue
/// detail panel without re-classifying the repo. Updated by
/// `fetchIssues` on every successful classification — same pattern
/// as `activePrContext` in `state/pull-requests.ts`.
const [activeIssuesContext, setActiveIssuesContext] = createSignal<
  { integrationType: string; owner: string; repo: string } | null
>(null);

export { activeIssuesContext };

/// State filter applied to the Issues panel. Same semantics as the
/// PR `PrStateFilter` so both panels can reuse the same segmented
/// control component.
export type IssueStateFilter = "all" | "open" | "closed";

const [issueStateFilter, setIssueStateFilter] = createSignal<IssueStateFilter>("open");
const [issueTextFilter, setIssueTextFilter] = createSignal<string>("");

export {
  issueStateFilter,
  setIssueStateFilter,
  issueTextFilter,
  setIssueTextFilter,
};

async function fetchIssues(path: string): Promise<IssuesResult> {
  let info: RepoProviderInfo;
  try {
    info = await getRepoProviderInfo(path);
  } catch (err) {
    setActiveIssuesContext(null);
    return { kind: "error", detail: String(err) };
  }
  if (!SUPPORTED_SERVICES.includes(info.service)) {
    setActiveIssuesContext(null);
    return { kind: "unsupported-provider", service: info.service };
  }
  if (!info.owner || !info.repo) {
    setActiveIssuesContext(null);
    return { kind: "bare-or-unparseable" };
  }
  const integrationType = integrationTypeFor(info.service);
  setActiveIssuesContext({ integrationType, owner: info.owner, repo: info.repo });
  let configured: string[];
  try {
    configured = await listConfiguredIntegrations();
  } catch (err) {
    return { kind: "error", detail: String(err) };
  }
  if (!configured.includes(integrationType)) {
    return { kind: "not-connected" };
  }
  try {
    const issues = await integrationListIssues(integrationType, info.owner, info.repo);
    return { kind: "ready", issues };
  } catch (err) {
    const detail = String(err);
    if (detail.includes("is not connected")) {
      return { kind: "not-connected" };
    }
    return { kind: "error", detail };
  }
}

/// Issues resource — keyed on `repoPath()`. Refetches when the user
/// opens a different repo. No filter/sort signals in v1; replicate
/// the PR-toolbar pattern when users push back.
export const [issues, { refetch: refetchIssues }] = createResource<IssuesResult, string>(
  () => repoPath(),
  fetchIssues,
);
