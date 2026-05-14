// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  For,
  Show,
  Suspense,
  createResource,
  createSignal,
  type JSX,
} from "solid-js";

import {
  listHooks,
  openHookScript,
  setHookEnabled,
  type HookEntry,
} from "../../../ipc";
import { repoPath } from "../../../state";

/**
 * Git hooks panel (issue #192). Lists every hook script in the active
 * repo's hooks directory (`core.hooksPath` if set, else
 * `<repo>/.git/hooks`), with a toggle that renames the file to/from
 * the `.disabled` suffix and an "Open" button that hands the file to
 * the OS default editor via `tauri-plugin-opener`.
 *
 * No in-app editor — that's GK's paid path and the issue explicitly
 * trims it. Sample files (`*.sample`) are filtered out at the backend.
 */
export function GitHooksPanel(): JSX.Element {
  const [hooks, { refetch }] = createResource<HookEntry[], string>(
    () => repoPath(),
    async (path) => {
      try {
        return await listHooks(path);
      } catch (err) {
        console.error("listHooks failed:", err);
        return [];
      }
    },
  );

  // Per-row pending flag so the toggle doesn't fire twice while a
  // rename is in flight. Cleared in the finally arm regardless of
  // success / failure.
  const [pending, setPending] = createSignal<Set<string>>(new Set());

  const isPending = (name: string) => pending().has(name);

  const setRowPending = (name: string, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  const onToggle = async (entry: HookEntry, nextValue: boolean) => {
    const path = repoPath();
    if (!path) return;
    setRowPending(entry.name, true);
    try {
      await setHookEnabled(path, entry.name, nextValue);
      await refetch();
    } catch (err) {
      console.error("setHookEnabled failed:", err);
    } finally {
      setRowPending(entry.name, false);
    }
  };

  const onOpen = async (entry: HookEntry) => {
    const path = repoPath();
    if (!path) return;
    try {
      await openHookScript(path, entry.name);
    } catch (err) {
      console.error("openHookScript failed:", err);
    }
  };

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Git hooks</h3>
      <p class="ui-panel__helper">
        Manage hook scripts in the active repository. Disabling a hook
        renames its file to <code>&lt;name&gt;.disabled</code> so Git
        skips it without losing the script. Open in your default editor
        to edit — yryvu doesn't bundle one. Sample files
        (<code>*.sample</code>) are hidden from this list.
      </p>

      <Show
        when={repoPath() !== undefined}
        fallback={
          <p class="ui-panel__helper">
            Open a repository to see its hooks. They live in{" "}
            <code>.git/hooks/</code> by default, or wherever{" "}
            <code>core.hooksPath</code> points.
          </p>
        }
      >
        <Suspense
          fallback={
            <p class="ui-panel__helper">Loading hooks…</p>
          }
        >
          <Show
            when={(hooks() ?? []).length > 0}
            fallback={
              <p class="ui-panel__helper">
                No hook scripts found. Drop an executable into the hooks
                directory to manage it from here.
              </p>
            }
          >
            <ul class="githooks-panel__list">
              <For each={hooks()}>
                {(entry) => (
                  <li class="githooks-panel__row">
                    <label class="githooks-panel__toggle-label">
                      <input
                        type="checkbox"
                        class="githooks-panel__toggle"
                        checked={entry.enabled}
                        disabled={isPending(entry.name)}
                        onChange={(e) =>
                          void onToggle(entry, e.currentTarget.checked)
                        }
                      />
                      <span class="githooks-panel__name">{entry.name}</span>
                      <span
                        class={`githooks-panel__pill ${
                          entry.enabled
                            ? "githooks-panel__pill--on"
                            : "githooks-panel__pill--off"
                        }`}
                      >
                        {entry.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </label>
                    <button
                      type="button"
                      class="ui-panel__btn ui-panel__btn--secondary"
                      onClick={() => void onOpen(entry)}
                    >
                      Open
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Suspense>
      </Show>
    </div>
  );
}
