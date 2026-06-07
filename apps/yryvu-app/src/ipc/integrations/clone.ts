// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Personal account vs organization / group ownership of a clone
/// candidate. Drives the dropdown's personal-first ordering.
export type OwnerKind = "user" | "organization";

/// Cross-provider repo candidate surfaced by the Clone dialog's
/// per-provider sub-tabs (#374). Backend mirrors the same shape.
export interface CloneRepoCandidate {
  owner: string;
  ownerKind: OwnerKind;
  name: string;
  fullName: string;
  cloneUrlHttps: string;
  cloneUrlSsh?: string;
  isPrivate: boolean;
  description?: string;
  defaultBranch?: string;
}

/// List every repo the authenticated user can clone via
/// `integrationType`. Bitbucket / Azure return `NotImplemented` from
/// the backend; the frontend renders a "backend pending" hint instead
/// of attempting the call.
export function integrationListCloneCandidates(
  integrationType: string,
): Promise<CloneRepoCandidate[]> {
  return invoke<CloneRepoCandidate[]>("integration_list_clone_candidates", {
    integrationType,
  });
}
