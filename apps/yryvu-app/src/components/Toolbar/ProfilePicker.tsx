// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";

import {
  activeProfile,
  openPreferences,
  profilesStore,
  repoPath,
  setActiveRepoOverride,
} from "../../state";
import { IconCheck, IconChevronDown, IconPlus, IconUsers } from "../Icons";
import { ProfileAvatar } from "../Profiles/ProfileAvatar";

/**
 * Toolbar profile picker — GitKraken's `ProfileAccountMenu`, trimmed to
 * the local-profile surface (no account sign-in / org rows). The trigger
 * shows the profile resolved for the active repo (override → remote →
 * local); the dropdown lists every profile and pins one to this repo on
 * click. "Add a Profile" jumps to the Preferences panel where CRUD lives.
 */
export function ProfilePicker(): JSX.Element {
  let wrapperEl: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal(false);

  onMount(() => {
    const onDocPointer = (e: MouseEvent) => {
      if (!open()) return;
      if (wrapperEl && !wrapperEl.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    });
  });

  const profiles = () => profilesStore().profiles;
  const activeId = () => activeProfile()?.id;

  function pin(id: string): void {
    setOpen(false);
    if (repoPath()) void setActiveRepoOverride(id);
  }

  function addProfile(): void {
    setOpen(false);
    openPreferences("profiles");
  }

  return (
    <div class="profile-picker" ref={wrapperEl}>
      <button
        type="button"
        class="profile-picker__trigger"
        aria-label="Profile"
        aria-expanded={open()}
        title={activeProfile()?.displayName ?? "Profiles"}
        onClick={() => setOpen((v) => !v)}
      >
        <Show
          when={activeProfile()}
          fallback={
            <span class="profile-picker__placeholder" aria-hidden="true">
              <IconUsers />
            </span>
          }
        >
          {(p) => <ProfileAvatar profile={p()} size={24} />}
        </Show>
        <span class="profile-picker__caret" aria-hidden="true">
          <IconChevronDown />
        </span>
      </button>

      <Show when={open()}>
        <div class="profile-menu" role="menu">
          <div class="profile-menu__header">My Profiles</div>
          <Show
            when={profiles().length > 0}
            fallback={
              <div class="profile-menu__empty">No profiles yet</div>
            }
          >
            <ul class="profile-menu__list">
              <For each={profiles()}>
                {(p) => (
                  <li>
                    <button
                      type="button"
                      class="profile-menu__item"
                      classList={{
                        "profile-menu__item--active": p.id === activeId(),
                      }}
                      role="menuitemradio"
                      aria-checked={p.id === activeId()}
                      disabled={!repoPath()}
                      title={
                        repoPath()
                          ? "Switch to this profile"
                          : "Open a repository to switch profiles"
                      }
                      onClick={() => pin(p.id)}
                    >
                      <ProfileAvatar profile={p} size={28} />
                      <span class="profile-menu__item-text">
                        <span class="profile-menu__item-name">
                          {p.displayName || p.authorName || "Unnamed"}
                        </span>
                        <span class="profile-menu__item-email">
                          {p.authorEmail}
                        </span>
                      </span>
                      <Show when={p.id === activeId()}>
                        <span class="profile-menu__check" aria-hidden="true">
                          <IconCheck />
                        </span>
                      </Show>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <div class="profile-menu__separator" />
          <button
            type="button"
            class="profile-menu__add"
            role="menuitem"
            onClick={addProfile}
          >
            <IconPlus />
            <span>Add a Profile</span>
          </button>
        </div>
      </Show>
    </div>
  );
}
