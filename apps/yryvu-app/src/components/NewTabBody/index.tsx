// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";

import logoUrl from "../../assets/logo.svg";
import { validateGitRepo } from "../../ipc";
import {
  loadRecentRepos,
  pushRecentRepo,
  removeRecentRepo,
  setRepoPath,
  type RecentRepo,
} from "../../state";
import { currentTab } from "../../tabs/state";
import { openRepoInSelectedTab } from "../../tabs/ops";
import { notify } from "../Notifications";
import { openCloneDialog } from "../Onboarding/CloneDialog/state";
import { openInitDialog } from "../Onboarding/InitDialog/state";
import { Tooltip } from "../Tooltip";
import { IconClose } from "../Icons";
import { parentDir, RECENTLY_OPENED_LIMIT, relativeTime } from "./helpers";

export function NewTabBody() {
  const [recent, setRecent] = createSignal<RecentRepo[]>([]);

  onMount(() => setRecent(loadRecentRepos()));

  /// Mirrors `getRecentLocalReposWithoutCurrentlyOpenRepo` (bundle:352645).
  /// Opening the already-open repo would no-op via `switchToRepoTabIfItExists`;
  /// hide it from the grid so the click never reaches that path.
  const visibleRecent = createMemo<RecentRepo[]>(() => {
    const cur = currentTab();
    const currentPath = cur?.type === "REPO" ? cur.repoPath : undefined;
    const filtered = currentPath
      ? recent().filter((r) => r.path !== currentPath)
      : recent();
    return filtered.slice(0, RECENTLY_OPENED_LIMIT);
  });

  async function openPicker() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open a Git repository",
    });
    if (typeof selected !== "string") return;
    const status = await validateGitRepo(selected);
    if (status === "not-a-repo") {
      notify.error(`${selected} is not a Git repository — clone or init it first.`);
      return;
    }
    if (status === "inaccessible-path") {
      notify.error(`${selected} is not accessible (permissions or removed).`);
      return;
    }
    setRecent(pushRecentRepo(selected));
    setRepoPath(selected);
    void openRepoInSelectedTab(selected);
  }

  function openFromRecent(path: string) {
    setRecent(pushRecentRepo(path));
    setRepoPath(path);
    void openRepoInSelectedTab(path);
  }

  function removeFromRecent(e: MouseEvent, path: string) {
    e.stopPropagation();
    setRecent(removeRecentRepo(path));
  }

  return (
    <section class="new-tab">
      <div class="new-tab__brand">
        <img class="new-tab__hero" src={logoUrl} alt="Yryvu" />
        <div class="new-tab__brand-text">
          <h1 class="new-tab__brand-name">Yryvu</h1>
          <p class="new-tab__brand-tagline">jote (Coragyps atratus) en guaraní</p>
        </div>
      </div>

      <header class="new-tab__header">
        <h2 class="new-tab__title">New Tab</h2>
        <span class="new-tab__shortcut">(Ctrl+T)</span>
      </header>

      <div class="new-tab__actions">
        <button class="new-tab__action" type="button" onClick={openPicker}>
          Open repo
        </button>
        <button class="new-tab__action" type="button" onClick={openCloneDialog}>
          Clone repo
        </button>
        <button class="new-tab__action" type="button" onClick={openInitDialog}>
          Init repo
        </button>
      </div>

      <p class="new-tab__recent-title">Recently opened</p>
      <Show
        when={visibleRecent().length > 0}
        fallback={
          <p class="new-tab__recent-empty">No recently opened repositories.</p>
        }
      >
        <div class="new-tab__grid" role="list">
          <For each={visibleRecent()}>
            {(r) => (
              <button
                class="new-tab__card"
                type="button"
                role="listitem"
                onClick={() => openFromRecent(r.path)}
              >
                <span class="new-tab__card-name">{r.name}</span>
                <span class="new-tab__card-dir">{parentDir(r.path)}</span>
                <span class="new-tab__card-time">
                  {relativeTime(r.openedAt)}
                </span>
                <Tooltip text="Remove from recents">
                  <span
                    class="new-tab__card-remove"
                    role="button"
                    tabIndex={0}
                    aria-label="Remove from recents"
                    onClick={(e) => removeFromRecent(e, r.path)}
                  >
                    <IconClose />
                  </span>
                </Tooltip>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
