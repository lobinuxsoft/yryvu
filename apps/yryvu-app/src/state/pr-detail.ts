// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal } from "solid-js";

import {
  integrationGetPrDetail,
  integrationListPrChecks,
  integrationListPrCommits,
  integrationListPrFiles,
  type CheckRun,
  type PrCommit,
  type PrFile,
  type PullRequestDetail,
} from "../ipc";
import { setMainView } from "./diff";

/// Identifies which PR's detail panel is currently active. `null`
/// when the user isn't on the detail view. Drives the MainView
/// switch in AppShell.
export interface PrDetailRef {
  integrationType: string;
  owner: string;
  repo: string;
  number: number;
  /// Head SHA captured at open time. Used by the Checks tab without
  /// having to wait for the detail resource to resolve. Updated when
  /// the detail resource fetches in case GitHub force-pushed the
  /// head between the row click and the panel open.
  headSha: string;
}

const [activePrDetail, setActivePrDetailInternal] = createSignal<PrDetailRef | null>(null);

export { activePrDetail };

/// Open the PR detail panel for `ref`. Switches MainView so AppShell
/// renders the detail panel in place of the commit graph.
export function openPrDetail(ref: PrDetailRef): void {
  setActivePrDetailInternal(ref);
  setMainView("prDetail");
}

/// Close the detail panel and drop the user back at the commit graph.
export function closePrDetail(): void {
  setActivePrDetailInternal(null);
  setMainView("graph");
}

const [prDetailDetail, { refetch: refetchPrDetail }] = createResource<
  PullRequestDetail | null,
  PrDetailRef
>(
  () => activePrDetail() ?? (undefined as unknown as PrDetailRef),
  async (ref) => {
    return integrationGetPrDetail(
      ref.integrationType,
      ref.owner,
      ref.repo,
      ref.number,
    );
  },
);

const [prDetailCommits, { refetch: refetchPrCommits }] = createResource<
  PrCommit[],
  PrDetailRef
>(
  () => activePrDetail() ?? (undefined as unknown as PrDetailRef),
  async (ref) =>
    integrationListPrCommits(
      ref.integrationType,
      ref.owner,
      ref.repo,
      ref.number,
    ),
);

const [prDetailFiles, { refetch: refetchPrFiles }] = createResource<
  PrFile[],
  PrDetailRef
>(
  () => activePrDetail() ?? (undefined as unknown as PrDetailRef),
  async (ref) =>
    integrationListPrFiles(
      ref.integrationType,
      ref.owner,
      ref.repo,
      ref.number,
    ),
);

/// Checks resource keyed on (ref.integrationType, ref.owner, ref.repo,
/// detail.headSha) — re-fetches when the detail resolves so the
/// Checks tab shows the freshest head's runs even if the row was
/// stale.
const [prDetailChecks, { refetch: refetchPrChecks }] = createResource<
  CheckRun[],
  { ref: PrDetailRef; headSha: string }
>(
  () => {
    const ref = activePrDetail();
    if (!ref) return undefined as unknown as { ref: PrDetailRef; headSha: string };
    const detail = prDetailDetail();
    const headSha = detail?.headSha ?? ref.headSha;
    if (!headSha) return undefined as unknown as { ref: PrDetailRef; headSha: string };
    return { ref, headSha };
  },
  async ({ ref, headSha }) =>
    integrationListPrChecks(ref.integrationType, ref.owner, ref.repo, headSha),
);

export {
  prDetailDetail,
  prDetailCommits,
  prDetailFiles,
  prDetailChecks,
  refetchPrDetail,
  refetchPrCommits,
  refetchPrFiles,
  refetchPrChecks,
};

/// Refetch every PR-detail resource. Called after a successful PR
/// action (close/reopen/draft/ready) so the panel reflects the
/// post-mutation state without forcing a tab reload.
export function refetchAllPrDetail(): void {
  refetchPrDetail();
  refetchPrCommits();
  refetchPrFiles();
  refetchPrChecks();
}
