// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RepoManagementBody — main viewport for the REPO_MANAGEMENT permanent
 * tab. Lists every repo known to chajá (from the recent-opened cache)
 * decorated with current branch + dirty count, with substring filter
 * + multi-select + bulk "Open in tabs" action.
 *
 * Out of scope (audit doc 09): workspaces (proprietary), repo grouping,
 * color tagging. Clone / Init buttons depend on #100 — render disabled
 * with a tooltip until that lands. "Open" works today: it calls the
 * Tauri directory picker (the same one the legacy folder button used
 * to call from the tab leading area before #209 reassigned it to
 * openRepoManagementTab).
 */

import { createMemo, createSignal, For, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";

import { type KnownRepoInfo } from "../../ipc";
import { pushRecentRepo, removeRecentRepo, setRepoPath } from "../../state";
import { openRepoInAnotherTab } from "../../tabs/ops";
import { NfIcon } from "../NfIcon";
import {
  ensureInitialized,
  loading,
  refreshKnownRepos,
  removeFromCache,
  repos,
} from "./store";

export function RepoManagementBody() {
  // The resource lives in store.ts, not here — see that module's header
  // for why (tab unmount / remount otherwise re-fires the IPC).
  ensureInitialized();
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<Set<string>>(new Set());

  const filtered = createMemo<KnownRepoInfo[]>(() => {
    const list = repos() ?? [];
    const q = query().trim().toLowerCase();
    if (q.length === 0) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q) ||
        (r.currentBranch?.toLowerCase().includes(q) ?? false),
    );
  });

  const toggleSelected = (path: string) => {
    const s = new Set<string>(selected());
    if (s.has(path)) s.delete(path);
    else s.add(path);
    setSelected(s);
  };

  const clearSelection = () => setSelected(new Set<string>());

  const onRowClick = (repo: KnownRepoInfo, e: MouseEvent) => {
    // Click on the checkbox itself is handled by its own onChange; only
    // body clicks reach here. If something is selected, treat row click
    // as multi-select (toggle this row in the selection). Else open
    // in another tab — the dispatcher dedupes via switchToRepoTabIfItExists.
    if (e.defaultPrevented) return;
    if (selected().size > 0) {
      toggleSelected(repo.path);
      return;
    }
    if (repo.error) return;
    void openRepoInAnotherTab(repo.path);
  };

  const onBulkOpen = () => {
    const targets = filtered().filter(
      (r) => selected().has(r.path) && !r.error,
    );
    for (const r of targets) {
      void openRepoInAnotherTab(r.path);
    }
    clearSelection();
  };

  const onBulkRemove = () => {
    const paths = Array.from(selected());
    for (const path of paths) {
      removeRecentRepo(path);
    }
    removeFromCache(paths);
    clearSelection();
  };

  const onRemoveSingle = (path: string, e: MouseEvent) => {
    e.stopPropagation();
    removeRecentRepo(path);
    removeFromCache([path]);
  };

  const onOpenClick = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open a Git repository",
    });
    if (typeof selected === "string") {
      pushRecentRepo(selected);
      setRepoPath(selected);
      void openRepoInAnotherTab(selected);
      refreshKnownRepos();
    }
  };

  const breadcrumbOf = (path: string): string => {
    const segs = path.split("/").filter(Boolean);
    if (segs.length <= 1) return "/";
    return "/" + segs.slice(0, -1).join("/");
  };

  return (
    <section class="repo-management">
      <header class="repo-management__header">
        <div class="repo-management__actions">
          <button
            class="repo-management__btn"
            type="button"
            onClick={onOpenClick}
            title="Open a local repository"
          >
            <NfIcon code="f07c" /> Open
          </button>
          <button
            class="repo-management__btn"
            type="button"
            disabled
            title="Wire after #100"
          >
            <NfIcon code="f0c5" /> Clone
          </button>
          <button
            class="repo-management__btn"
            type="button"
            disabled
            title="Wire after #100"
          >
            <NfIcon code="f067" /> Init
          </button>
        </div>
        <div class="repo-management__filter">
          <NfIcon code="f002" />
          <input
            type="text"
            placeholder="Filter repos by name, path, or branch"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            aria-label="Filter repos"
          />
          <button
            class="repo-management__refresh"
            type="button"
            onClick={refreshKnownRepos}
            title="Refresh"
            aria-label="Refresh"
          >
            <NfIcon code="f021" />
          </button>
        </div>
      </header>

      <Show
        when={repos().length > 0}
        fallback={
          <div class="repo-management__empty">
            <Show
              when={loading()}
              fallback={
                <>
                  <h2>No known repositories yet</h2>
                  <p>
                    Open a repo from the welcome tab and it'll show up here
                    for quick switching.
                  </p>
                </>
              }
            >
              Loading repositories…
            </Show>
          </div>
        }
      >
        <div class="repo-management__list" role="list" classList={{ "is-loading": loading() }}>
          <For each={filtered()}>
              {(repo) => (
                <div
                  class="repo-management__row"
                  classList={{
                    "is-selected": selected().has(repo.path),
                    "is-stale": !!repo.error,
                  }}
                  role="listitem"
                  onClick={(e) => onRowClick(repo, e)}
                  title={repo.error ?? repo.path}
                >
                  <input
                    type="checkbox"
                    class="repo-management__row-check"
                    checked={selected().has(repo.path)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelected(repo.path)}
                    aria-label={`Select ${repo.name}`}
                  />
                  <div class="repo-management__row-main">
                    <div class="repo-management__row-name">{repo.name}</div>
                    <div class="repo-management__row-path">
                      {breadcrumbOf(repo.path)}
                    </div>
                  </div>
                  <Show when={repo.currentBranch}>
                    <div class="repo-management__row-branch">
                      <NfIcon code="f126" /> {repo.currentBranch}
                    </div>
                  </Show>
                  <Show when={repo.dirtyCount > 0}>
                    <div
                      class="repo-management__row-dirty"
                      title={`${repo.dirtyCount} uncommitted change${repo.dirtyCount === 1 ? "" : "s"}`}
                    >
                      ●&nbsp;{repo.dirtyCount}
                    </div>
                  </Show>
                  <Show when={repo.error}>
                    <div
                      class="repo-management__row-error"
                      title={repo.error ?? ""}
                    >
                      missing
                    </div>
                  </Show>
                  <button
                    class="repo-management__row-remove"
                    type="button"
                    aria-label={`Remove ${repo.name} from recents`}
                    title="Remove from recents"
                    onClick={(e) => onRemoveSingle(repo.path, e)}
                  >
                    <NfIcon code="f00d" />
                  </button>
                </div>
              )}
            </For>
        </div>
      </Show>

      <Show when={selected().size > 0}>
        <footer class="repo-management__footer">
          <span class="repo-management__footer-count">
            Selected: {selected().size}
          </span>
          <button
            class="repo-management__btn"
            type="button"
            onClick={onBulkOpen}
          >
            Open in tabs
          </button>
          <button
            class="repo-management__btn"
            type="button"
            disabled
            title="Wire after backend bulk fetch lands"
          >
            Fetch
          </button>
          <button
            class="repo-management__btn"
            type="button"
            disabled
            title="Wire after backend bulk pull lands"
          >
            Pull
          </button>
          <button
            class="repo-management__btn repo-management__btn--danger"
            type="button"
            onClick={onBulkRemove}
            title="Remove the selected entries from the recents list"
          >
            Remove from recents
          </button>
          <button
            class="repo-management__btn repo-management__btn--ghost"
            type="button"
            onClick={clearSelection}
          >
            Clear
          </button>
        </footer>
      </Show>
    </section>
  );
}
