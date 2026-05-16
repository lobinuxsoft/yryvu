// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource } from "solid-js";

import type { Identifier } from "../ipc";
import {
  integrationListCollaborators,
  integrationListLabels,
  integrationListMilestones,
} from "../ipc";

export interface RepoMetadataKey {
  integrationType: string;
  owner: string;
  repo: string;
}

export interface RepoMetadata {
  labels: Identifier[];
  collaborators: Identifier[];
  milestones: Identifier[];
}

const EMPTY: RepoMetadata = { labels: [], collaborators: [], milestones: [] };

async function fetchRepoMetadata(key: RepoMetadataKey): Promise<RepoMetadata> {
  const [labels, collaborators, milestones] = await Promise.all([
    integrationListLabels(key.integrationType, key.owner, key.repo).catch(() => []),
    integrationListCollaborators(key.integrationType, key.owner, key.repo).catch(() => []),
    integrationListMilestones(key.integrationType, key.owner, key.repo).catch(() => []),
  ]);
  return { labels, collaborators, milestones };
}

/// Build a repo-metadata resource keyed on `keyAccessor()`. Returns
/// `EMPTY` when the key is null so dropdowns stay populated (with
/// nothing) and the form stays usable.
export function createRepoMetadataResource(keyAccessor: () => RepoMetadataKey | null) {
  return createResource<RepoMetadata, RepoMetadataKey>(
    () => keyAccessor() ?? null,
    (key) => (key ? fetchRepoMetadata(key) : Promise.resolve(EMPTY)),
    { initialValue: EMPTY },
  );
}
