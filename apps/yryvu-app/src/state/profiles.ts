// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, createSignal } from "solid-js";

import {
  deleteProfile as ipcDeleteProfile,
  listProfiles,
  resolveActiveProfile,
  saveProfile as ipcSaveProfile,
  setDefaultProfile as ipcSetDefaultProfile,
  setRepoProfileOverride as ipcSetRepoOverride,
  type Binding,
  type Profile,
  type ProfilesStore,
} from "../ipc";
import { repoPath } from "./repo-base";

const EMPTY_STORE: ProfilesStore = {
  version: 1,
  profiles: [],
  repoOverrides: {},
  defaultProfileId: null,
};

/// Bumped after every mutation so the per-repo `activeProfile` resource
/// re-resolves even though `repoPath()` (its other dependency) is
/// unchanged — a save can flip which profile a repo resolves to.
const [profilesNonce, bumpProfilesNonce] = createSignal(0, { equals: false });

/// The persisted profile store. Loaded once on startup; every mutation
/// replaces it with the backend's returned snapshot (single source of
/// truth — no optimistic local patching).
const [profilesStore, { mutate: mutateStore }] = createResource<ProfilesStore>(
  listProfiles,
  { initialValue: EMPTY_STORE },
);
export { profilesStore };

/// The profile resolved for the active repo: override → remote account →
/// local fallback. `null` when no repo is open or the store is empty.
const [activeProfile] = createResource(
  () => [repoPath(), profilesNonce()] as const,
  ([path]) => (path ? resolveActiveProfile(path) : Promise.resolve(null)),
);
export { activeProfile };

/// Adopt the backend's post-mutation snapshot and trigger a re-resolve.
async function applyStoreOp(op: Promise<ProfilesStore>): Promise<ProfilesStore> {
  const next = await op;
  mutateStore(next);
  bumpProfilesNonce((n) => n + 1);
  return next;
}

/// Build a blank profile with a fresh id. `authorName`/`authorEmail`
/// default to the git config identity passed by the form (or empty).
export function blankProfile(seed?: {
  authorName?: string;
  authorEmail?: string;
}): Profile {
  return {
    id: crypto.randomUUID(),
    displayName: "",
    authorName: seed?.authorName ?? "",
    authorEmail: seed?.authorEmail ?? "",
    avatar: null,
    signingKey: null,
    defaultBranch: null,
    binding: { kind: "local" } satisfies Binding,
  };
}

export function saveProfile(profile: Profile): Promise<ProfilesStore> {
  return applyStoreOp(ipcSaveProfile(profile));
}

export function deleteProfile(id: string): Promise<ProfilesStore> {
  return applyStoreOp(ipcDeleteProfile(id));
}

/// Clone a profile under a new id with a "(copy)" suffix.
export function duplicateProfile(id: string): Promise<ProfilesStore> {
  const source = profilesStore().profiles.find((p) => p.id === id);
  if (!source) return Promise.resolve(profilesStore());
  const copy: Profile = {
    ...source,
    id: crypto.randomUUID(),
    displayName: `${source.displayName} (copy)`,
  };
  return applyStoreOp(ipcSaveProfile(copy));
}

export function setDefaultProfile(id: string | null): Promise<ProfilesStore> {
  return applyStoreOp(ipcSetDefaultProfile(id));
}

/// Pin (or clear, with `null`) a profile for the currently open repo.
export function setActiveRepoOverride(
  profileId: string | null,
): Promise<ProfilesStore> {
  const path = repoPath();
  if (!path) return Promise.resolve(profilesStore());
  return applyStoreOp(ipcSetRepoOverride(path, profileId));
}
