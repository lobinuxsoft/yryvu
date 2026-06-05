// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, Show, type JSX } from "solid-js";

import { getCommitSignConfig, type Profile } from "../../../../ipc";
import {
  blankProfile,
  deleteProfile,
  duplicateProfile,
  profilesStore,
  repoPath,
  saveProfile,
  setDefaultProfile,
} from "../../../../state";
import { ConfirmDialog } from "../../../Toolbar/ConfirmDialog";
import { ProfileAvatar } from "../../../Profiles/ProfileAvatar";
import { ProfileForm } from "./ProfileForm";

/// `null` = list view; `"new"` = create form; a profile id = edit form.
type Editing = null | "new" | string;

function bindingLabel(profile: Profile): string {
  return profile.binding.kind === "account"
    ? `Account · ${profile.binding.service}`
    : "Local";
}

/**
 * Profiles preferences panel (issue #22). Lists every profile with
 * inline edit / duplicate / delete / set-default actions and an
 * add-form. Each profile stores a commit identity applied in memory at
 * commit time per the active-repo resolution (override → remote →
 * local) — the global `.gitconfig` is never written.
 */
export function ProfilesPanel(): JSX.Element {
  const [editing, setEditing] = createSignal<Editing>(null);
  const [draft, setDraft] = createSignal<Profile | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<Profile | null>(null);

  const profiles = () => profilesStore().profiles;
  const defaultId = () => profilesStore().defaultProfileId;

  async function startNew(): Promise<void> {
    const path = repoPath();
    let seed: { authorName?: string; authorEmail?: string } | undefined;
    if (path) {
      try {
        const cfg = await getCommitSignConfig(path);
        seed = {
          authorName: cfg.userName ?? undefined,
          authorEmail: cfg.userEmail ?? undefined,
        };
      } catch (err) {
        console.error("getCommitSignConfig failed:", err);
      }
    }
    setDraft(blankProfile(seed));
    setEditing("new");
  }

  function startEdit(profile: Profile): void {
    setDraft({ ...profile });
    setEditing(profile.id);
  }

  function closeForm(): void {
    setEditing(null);
    setDraft(null);
  }

  async function onSave(profile: Profile): Promise<void> {
    try {
      await saveProfile(profile);
      closeForm();
    } catch (err) {
      console.error("saveProfile failed:", err);
    }
  }

  async function confirmDelete(): Promise<void> {
    const target = pendingDelete();
    setPendingDelete(null);
    if (!target) return;
    try {
      await deleteProfile(target.id);
      if (editing() === target.id) closeForm();
    } catch (err) {
      console.error("deleteProfile failed:", err);
    }
  }

  return (
    <div class="preferences__section-body profiles-panel">
      <p class="ui-panel__helper">
        Profiles store a commit identity (author name + email) applied per
        repository. The active profile is resolved from the repo's remote
        account, or pinned manually from the toolbar; repos with no
        recognised remote use a Local profile. Your global{" "}
        <code>.gitconfig</code> is never modified.
      </p>

      <Show when={editing() === null}>
        <Show
          when={profiles().length > 0}
          fallback={<p class="ui-panel__helper">No profiles yet.</p>}
        >
          <ul class="profiles-panel__list">
            <For each={profiles()}>
              {(profile) => (
                <li class="profiles-panel__row">
                  <ProfileAvatar profile={profile} size={36} />
                  <span class="profiles-panel__row-text">
                    <span class="profiles-panel__row-name">
                      {profile.displayName || profile.authorName || "Unnamed"}
                      <Show when={profile.id === defaultId()}>
                        <span class="profiles-panel__badge">Default</span>
                      </Show>
                    </span>
                    <span class="profiles-panel__row-meta">
                      {profile.authorEmail} · {bindingLabel(profile)}
                    </span>
                  </span>
                  <span class="profiles-panel__row-actions">
                    <Show when={profile.id !== defaultId()}>
                      <button
                        type="button"
                        class="ui-panel__btn ui-panel__btn--secondary"
                        onClick={() => void setDefaultProfile(profile.id)}
                      >
                        Set default
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="ui-panel__btn ui-panel__btn--secondary"
                      onClick={() => startEdit(profile)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class="ui-panel__btn ui-panel__btn--secondary"
                      onClick={() => void duplicateProfile(profile.id)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      class="ui-panel__btn ui-panel__btn--danger"
                      onClick={() => setPendingDelete(profile)}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <div class="profiles-panel__actions">
          <button
            type="button"
            class="ui-panel__btn"
            onClick={() => void startNew()}
          >
            Add Profile
          </button>
        </div>
      </Show>

      <Show when={editing() !== null && draft()}>
        {(profile) => (
          <ProfileForm
            profile={profile()}
            isNew={editing() === "new"}
            onSave={(p) => void onSave(p)}
            onCancel={closeForm}
          />
        )}
      </Show>

      <ConfirmDialog
        open={pendingDelete() !== null}
        title="Delete profile"
        body={`Delete "${
          pendingDelete()?.displayName || pendingDelete()?.authorName || ""
        }"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
