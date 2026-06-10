// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `yryvu_bridge::profiles::Binding`. Adjacently tagged
/// (`kind` + `service`) per the backend serde. `account` profiles
/// auto-resolve when a repo's `origin` classifies to `service`
/// (`"github"` / `"gitlab"` / `"gitea"` / `"bitbucket"`); `local` is the
/// fallback identity for repos with no recognised remote.
export type Binding =
  | { kind: "account"; service: string }
  | { kind: "local" };

/// The provider services a profile can bind to. `local` is not a
/// provider — it's the unbound fallback.
export type ProfileService = "github" | "gitlab" | "gitea" | "bitbucket";

/// Mirrors `yryvu_bridge::profiles::Profile`. `id` is generated here
/// (`crypto.randomUUID()`) and is the stable key the backend uses for
/// overrides and the default pointer.
export interface Profile {
  id: string;
  displayName: string;
  authorName: string;
  authorEmail: string;
  avatar: string | null;
  signingKey: string | null;
  defaultBranch: string | null;
  binding: Binding;
}

/// Mirrors `yryvu_bridge::profiles::ProfilesStore`. `version` is owned by
/// the backend — never mutate it from here. `repoOverrides` maps a
/// canonical repo path to a pinned profile id.
export interface ProfilesStore {
  version: number;
  profiles: Profile[];
  repoOverrides: Record<string, string>;
  defaultProfileId: string | null;
}

export function listProfiles(): Promise<ProfilesStore> {
  return invoke<ProfilesStore>("list_profiles");
}

export function saveProfile(profile: Profile): Promise<ProfilesStore> {
  return invoke<ProfilesStore>("save_profile", { profile });
}

export function deleteProfile(id: string): Promise<ProfilesStore> {
  return invoke<ProfilesStore>("delete_profile", { id });
}

export function setDefaultProfile(id: string | null): Promise<ProfilesStore> {
  return invoke<ProfilesStore>("set_default_profile", { id });
}

/// Pin (`profileId`) or clear (`null`) the profile for a specific repo.
export function setRepoProfileOverride(
  repoPath: string,
  profileId: string | null,
): Promise<ProfilesStore> {
  return invoke<ProfilesStore>("set_repo_profile_override", {
    repoPath,
    profileId,
  });
}

/// Resolve the active profile for a repo (override → remote → local).
/// `null` when the store has no profiles.
export function resolveActiveProfile(
  repoPath: string,
): Promise<Profile | null> {
  return invoke<Profile | null>("resolve_active_profile", { repoPath });
}
