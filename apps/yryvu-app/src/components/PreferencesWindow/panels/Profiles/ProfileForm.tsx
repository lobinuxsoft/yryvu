// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show, type JSX } from "solid-js";

import type { Binding, Profile, ProfileService } from "../../../../ipc";

const SERVICES: ProfileService[] = ["github", "gitlab", "gitea", "bitbucket"];

const SERVICE_LABELS: Record<ProfileService, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  bitbucket: "Bitbucket",
};

function normalize(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface ProfileFormProps {
  profile: Profile;
  isNew: boolean;
  onSave: (profile: Profile) => void;
  onCancel: () => void;
}

/**
 * Add / edit form for a single profile. Mirrors GitKraken's
 * `ProfileAddEdit` fields: profile name, author name/email, type
 * (Local vs a provider account), default signing key, default branch.
 * Identity defaults to the git config values seeded by the caller.
 */
export function ProfileForm(props: ProfileFormProps): JSX.Element {
  const [displayName, setDisplayName] = createSignal(props.profile.displayName);
  const [authorName, setAuthorName] = createSignal(props.profile.authorName);
  const [authorEmail, setAuthorEmail] = createSignal(props.profile.authorEmail);
  const [signingKey, setSigningKey] = createSignal(
    props.profile.signingKey ?? "",
  );
  const [defaultBranch, setDefaultBranch] = createSignal(
    props.profile.defaultBranch ?? "",
  );
  const [kind, setKind] = createSignal<Binding["kind"]>(props.profile.binding.kind);
  const [service, setService] = createSignal<ProfileService>(
    props.profile.binding.kind === "account"
      ? (props.profile.binding.service as ProfileService)
      : "github",
  );

  const canSave = () =>
    displayName().trim().length > 0 &&
    authorName().trim().length > 0 &&
    authorEmail().trim().length > 0;

  function buildBinding(): Binding {
    return kind() === "account"
      ? { kind: "account", service: service() }
      : { kind: "local" };
  }

  function submit(): void {
    if (!canSave()) return;
    props.onSave({
      ...props.profile,
      displayName: displayName().trim(),
      authorName: authorName().trim(),
      authorEmail: authorEmail().trim(),
      signingKey: normalize(signingKey()),
      defaultBranch: normalize(defaultBranch()),
      binding: buildBinding(),
    });
  }

  return (
    <form
      class="profiles-panel__form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div class="profiles-panel__field">
        <label class="ui-panel__label" for="profile-name">
          Profile Name
        </label>
        <input
          id="profile-name"
          class="profiles-panel__input"
          type="text"
          value={displayName()}
          onInput={(e) => setDisplayName(e.currentTarget.value)}
        />
      </div>

      <div class="profiles-panel__field">
        <label class="ui-panel__label" for="profile-author-name">
          Author Name
        </label>
        <input
          id="profile-author-name"
          class="profiles-panel__input"
          type="text"
          value={authorName()}
          onInput={(e) => setAuthorName(e.currentTarget.value)}
        />
      </div>

      <div class="profiles-panel__field">
        <label class="ui-panel__label" for="profile-author-email">
          Author Email
        </label>
        <input
          id="profile-author-email"
          class="profiles-panel__input"
          type="email"
          value={authorEmail()}
          onInput={(e) => setAuthorEmail(e.currentTarget.value)}
        />
      </div>

      <div class="profiles-panel__field">
        <label class="ui-panel__label" for="profile-type">
          Profile Type
        </label>
        <select
          id="profile-type"
          class="profiles-panel__input"
          value={kind()}
          onChange={(e) => setKind(e.currentTarget.value as Binding["kind"])}
        >
          <option value="local">Local</option>
          <option value="account">Account</option>
        </select>
        <span class="ui-panel__helper">
          <Show
            when={kind() === "account"}
            fallback="Used for repos with no recognised remote."
          >
            Auto-selected when a repo's origin matches this provider.
          </Show>
        </span>
      </div>

      <Show when={kind() === "account"}>
        <div class="profiles-panel__field">
          <label class="ui-panel__label" for="profile-service">
            Provider
          </label>
          <select
            id="profile-service"
            class="profiles-panel__input"
            value={service()}
            onChange={(e) =>
              setService(e.currentTarget.value as ProfileService)
            }
          >
            {SERVICES.map((s) => (
              <option value={s}>{SERVICE_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </Show>

      <div class="profiles-panel__field">
        <label class="ui-panel__label" for="profile-signing-key">
          Default signing key
        </label>
        <input
          id="profile-signing-key"
          class="profiles-panel__input"
          type="text"
          placeholder="Fingerprint or SSH key path (optional)"
          value={signingKey()}
          onInput={(e) => setSigningKey(e.currentTarget.value)}
        />
      </div>

      <div class="profiles-panel__field">
        <label class="ui-panel__label" for="profile-default-branch">
          Default branch name
        </label>
        <input
          id="profile-default-branch"
          class="profiles-panel__input"
          type="text"
          placeholder="main (optional)"
          value={defaultBranch()}
          onInput={(e) => setDefaultBranch(e.currentTarget.value)}
        />
      </div>

      <div class="profiles-panel__actions">
        <button
          type="button"
          class="ui-panel__btn ui-panel__btn--secondary"
          onClick={props.onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          class="ui-panel__btn"
          disabled={!canSave()}
        >
          {props.isNew ? "Add Profile" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
