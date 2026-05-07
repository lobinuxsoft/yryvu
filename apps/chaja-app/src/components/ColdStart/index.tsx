// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, onMount, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";

import { loadRecentRepos, pushRecentRepo, setRepoPath, type RecentRepo } from "../../state";
import { openRepoInAnotherTab } from "../../tabs/ops";
import { openInitDialog } from "../Onboarding/InitDialog/state";

export function ColdStart() {
  const [recent, setRecent] = createSignal<RecentRepo[]>([]);

  onMount(() => setRecent(loadRecentRepos()));

  async function openPicker() {
    const selected = await open({ directory: true, multiple: false, title: "Open a Git repository" });
    if (typeof selected === "string") {
      setRecent(pushRecentRepo(selected));
      setRepoPath(selected);
      void openRepoInAnotherTab(selected);
    }
  }

  function openFromRecent(path: string) {
    setRecent(pushRecentRepo(path));
    setRepoPath(path);
    void openRepoInAnotherTab(path);
  }

  return (
    <section class="cold-start">
      <div>
        <h2 class="cold-start__title">Repositories</h2>
        <div class="cold-start__actions">
          <button class="cold-start__action" type="button" onClick={openPicker}>Open…</button>
          <button class="cold-start__action" type="button" disabled title="Not yet implemented">Clone…</button>
          <button class="cold-start__action" type="button" onClick={openInitDialog}>Create…</button>
        </div>
        <p class="cold-start__recent-title">Recent</p>
        <Show when={recent().length > 0} fallback={<p class="cold-start__recent-item-path">No recently opened repositories.</p>}>
          <div class="cold-start__recent">
            <For each={recent()}>
              {(r) => (
                <button class="cold-start__recent-item" type="button" onClick={() => openFromRecent(r.path)}>
                  <span class="cold-start__recent-item-name">{r.name}</span>
                  <span class="cold-start__recent-item-path">{r.path}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <aside>
        <h2 class="cold-start__title">Getting started</h2>
        <p class="cold-start__aside-title">Resources</p>
        <button class="cold-start__aside-link" type="button" disabled>Documentation</button>
        <button class="cold-start__aside-link" type="button" disabled>Keyboard shortcuts</button>
        <button class="cold-start__aside-link" type="button" disabled>Release notes</button>
      </aside>
    </section>
  );
}
