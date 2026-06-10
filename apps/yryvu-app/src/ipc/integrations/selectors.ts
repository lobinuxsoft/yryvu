// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Provider-agnostic identifier carried in dropdown options. `id` is
/// what we re-send on create; `displayName` is what we render. For
/// label-shaped options `color` is a hex string (no leading `#`).
export interface Identifier {
  id: string;
  displayName: string;
  avatarUrl?: string;
  color?: string;
}

export function integrationListLabels(
  integrationType: string,
  owner: string,
  repo: string,
): Promise<Identifier[]> {
  return invoke<Identifier[]>("integration_list_labels", {
    integrationType,
    owner,
    repo,
  });
}

export function integrationListCollaborators(
  integrationType: string,
  owner: string,
  repo: string,
): Promise<Identifier[]> {
  return invoke<Identifier[]>("integration_list_collaborators", {
    integrationType,
    owner,
    repo,
  });
}

export function integrationListMilestones(
  integrationType: string,
  owner: string,
  repo: string,
): Promise<Identifier[]> {
  return invoke<Identifier[]>("integration_list_milestones", {
    integrationType,
    owner,
    repo,
  });
}
