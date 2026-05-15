// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal } from "solid-js";

import { integrationGetIssueDetail, type IssueDetail } from "../ipc";
import { setMainView } from "./diff";

/// Identifies which issue's detail panel is currently active. `null`
/// when the user isn't on the detail view. Drives the MainView
/// switch in AppShell (parallel to `activePrDetail`).
export interface IssueDetailRef {
  integrationType: string;
  owner: string;
  repo: string;
  number: number;
}

const [activeIssueDetail, setActiveIssueDetailInternal] =
  createSignal<IssueDetailRef | null>(null);

export { activeIssueDetail };

/// Open the issue detail panel. Switches MainView so AppShell renders
/// the detail panel in place of the commit graph.
export function openIssueDetail(ref: IssueDetailRef): void {
  setActiveIssueDetailInternal(ref);
  setMainView("issueDetail");
}

/// Close the detail panel and drop the user back at the graph.
export function closeIssueDetail(): void {
  setActiveIssueDetailInternal(null);
  setMainView("graph");
}

/// Issue detail resource — keyed on the active ref. Refetches when
/// the user opens a different issue.
export const [issueDetail, { refetch: refetchIssueDetail }] = createResource<
  IssueDetail,
  IssueDetailRef
>(
  () => activeIssueDetail() ?? (undefined as unknown as IssueDetailRef),
  async (ref) =>
    integrationGetIssueDetail(ref.integrationType, ref.owner, ref.repo, ref.number),
);
