// SPDX-License-Identifier: AGPL-3.0-or-later

//! Pure helpers for the per-provider Clone sub-tabs (#374). Lives in
//! its own module so render-mode dispatch + dropdown grouping can be
//! tested without mounting the SolidJS component.

import type { CloneRepoCandidate } from "../../../ipc";
import type { IntegrationState } from "../../PreferencesWindow/panels/Integrations/state";
import type { ProviderInfo } from "../../PreferencesWindow/panels/Integrations/providerTable";

/// What the right pane should render for a given provider sub-tab.
/// Drives both copy + which form is mounted.
export type RenderMode =
  | { kind: "backendPending" }
  | { kind: "notConnected" }
  | { kind: "connecting" }
  | { kind: "connected" };

/// Provider cohorts whose backend is not yet wired (Bitbucket /
/// Bitbucket Data Center / Azure DevOps as of v1). The Clone sub-tab
/// renders a polite "backend pending" hint instead of a connect CTA
/// so the user knows the gap is by design — no spin-off issue per
/// `feedback_no_issue_splits`.
const BACKEND_PENDING: ReadonlySet<ProviderInfo["type"]> = new Set([
  "bitbucket",
  "bitbucketServer",
  "azureDevops",
]);

/// Pick the right render mode for one provider sub-tab. Provider
/// cohort wins first (no point asking the user to connect Bitbucket
/// if the backend isn't there); then the live integration state.
export function renderModeFor(
  provider: ProviderInfo,
  state: IntegrationState,
): RenderMode {
  if (BACKEND_PENDING.has(provider.type)) return { kind: "backendPending" };
  switch (state.tag) {
    case "connected":
      return { kind: "connected" };
    case "connecting":
    case "disconnecting":
      return { kind: "connecting" };
    default:
      return { kind: "notConnected" };
  }
}

/// One candidate row inside an owner group. Same shape as the
/// candidate it came from — re-exported here so the grouping helper
/// stays self-contained.
export type CandidateRow = CloneRepoCandidate;

/// Owner group rendered as a section in the dropdown — header label
/// (owner login or "YOUR REPOS" for the personal namespace) + the
/// rows belonging to that owner.
export interface OwnerGroup {
  /// Owner login / namespace path. Used as the React key.
  owner: string;
  /// Header label as rendered in the dropdown — UPPERCASED for orgs
  /// (mirrors GK), `"Your repos"` sentinel for the personal account.
  /// `null` for the special personal section header.
  headerLabel: string;
  /// `true` when this group represents the user's personal account.
  /// Renders first in the dropdown.
  isPersonal: boolean;
  rows: CandidateRow[];
}

/// Group + sort candidates for the dropdown. Personal rows first
/// (under a single "Your repos" header), then each organization in
/// alphabetical order with its rows alphabetised by `name`.
export function groupCandidates(
  candidates: readonly CandidateRow[],
): OwnerGroup[] {
  const personal: CandidateRow[] = [];
  const orgs = new Map<string, CandidateRow[]>();
  for (const candidate of candidates) {
    if (candidate.ownerKind === "user") {
      personal.push(candidate);
    } else {
      const bucket = orgs.get(candidate.owner) ?? [];
      bucket.push(candidate);
      orgs.set(candidate.owner, bucket);
    }
  }
  const sortByName = (a: CandidateRow, b: CandidateRow): number =>
    a.name.localeCompare(b.name);
  const result: OwnerGroup[] = [];
  if (personal.length > 0) {
    personal.sort(sortByName);
    result.push({
      owner: "__personal__",
      headerLabel: "Your repos",
      isPersonal: true,
      rows: personal,
    });
  }
  const orgKeys = Array.from(orgs.keys()).sort((a, b) => a.localeCompare(b));
  for (const owner of orgKeys) {
    const rows = orgs.get(owner) ?? [];
    rows.sort(sortByName);
    result.push({
      owner,
      headerLabel: owner.toUpperCase(),
      isPersonal: false,
      rows,
    });
  }
  return result;
}

/// Filter candidates by a free-form query string. Matches against
/// `full_name` and `name`, case-insensitive, substring. Empty query
/// returns the input unchanged.
export function filterCandidates(
  candidates: readonly CandidateRow[],
  query: string,
): CandidateRow[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [...candidates];
  return candidates.filter(
    (c) =>
      c.fullName.toLowerCase().includes(trimmed) ||
      c.name.toLowerCase().includes(trimmed),
  );
}
