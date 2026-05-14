// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, onMount, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";

import logoUrl from "../../assets/logo.svg";
import { validateGitRepo } from "../../ipc";
import { loadRecentRepos, pushRecentRepo, setRepoPath, type RecentRepo } from "../../state";
import { openRepoInAnotherTab } from "../../tabs/ops";
import { notify } from "../Notifications";
import { openCloneDialog } from "../Onboarding/CloneDialog/state";
import { openInitDialog } from "../Onboarding/InitDialog/state";

export function ColdStart() {
  const [recent, setRecent] = createSignal<RecentRepo[]>([]);

  onMount(() => setRecent(loadRecentRepos()));

  async function openPicker() {
    const selected = await open({ directory: true, multiple: false, title: "Open a Git repository" });
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
    void openRepoInAnotherTab(selected);
  }

  function openFromRecent(path: string) {
    setRecent(pushRecentRepo(path));
    setRepoPath(path);
    void openRepoInAnotherTab(path);
  }

  return (
    <section class="cold-start">
      <div>
        <div class="cold-start__brand">
          <img class="cold-start__hero" src={logoUrl} alt="Yryvu" />
          <div class="cold-start__brand-text">
            <h1 class="cold-start__brand-name">Yryvu</h1>
            <p class="cold-start__brand-tagline">jote (Coragyps atratus) en guaraní</p>
          </div>
        </div>
        <h2 class="cold-start__title">Repositories</h2>
        <div class="cold-start__actions">
          <button class="cold-start__action" type="button" onClick={openPicker}>Open…</button>
          <button class="cold-start__action" type="button" onClick={openCloneDialog}>Clone…</button>
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
