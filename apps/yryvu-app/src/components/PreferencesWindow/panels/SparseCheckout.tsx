// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Show,
  Suspense,
  createEffect,
  createResource,
  createSignal,
  type JSX,
} from "solid-js";

import {
  getSparseCheckoutState,
  sparseDisable,
  sparseInit,
  sparseReapply,
  sparseSetPatterns,
  type SparseCheckoutState,
} from "../../../ipc";
import { repoPath } from "../../../state";

/**
 * Sparse Checkout panel (issue #309).
 *
 * Per-repo state lives in `.git/config core.sparseCheckout` +
 * `core.sparseCheckoutCone` + the `.git/info/sparse-checkout` patterns
 * file. The panel reads the current state, then drives four
 * operations through the `git` CLI (libgit2 / gix don't expose
 * sparse-checkout; shell-out is the precedent already used by
 * `repo::submodules` and `repo::smart_branches`).
 *
 * Operations:
 *
 * - **Enable** — runs `git sparse-checkout init [--cone]`. Cone mode
 *   is the safer default (only directory paths, no glob footguns).
 * - **Apply patterns** — runs `git sparse-checkout set` with the
 *   textarea contents (one pattern per non-blank, non-comment line).
 * - **Reapply** — re-runs current patterns. Useful after a pull
 *   landed new files that should be hidden.
 * - **Disable** — restores every file and clears the bit.
 */
export function SparseCheckoutPanel(): JSX.Element {
  const [state, { refetch }] = createResource<SparseCheckoutState, string>(
    () => repoPath(),
    async (path) => {
      try {
        return await getSparseCheckoutState(path);
      } catch (err) {
        console.error("getSparseCheckoutState failed:", err);
        return { enabled: false, coneMode: false, patterns: [] };
      }
    },
  );

  const [coneLocal, setConeLocal] = createSignal(true);
  const [patternsLocal, setPatternsLocal] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  createEffect(() => {
    const s = state();
    if (!s) return;
    setConeLocal(s.coneMode || !s.enabled); // default cone on for first init
    setPatternsLocal(s.patterns.join("\n"));
  });

  const splitPatterns = (raw: string): string[] =>
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

  const runOp = async (op: () => Promise<void>) => {
    setBusy(true);
    try {
      await op();
      await refetch();
    } catch (err) {
      console.error("sparse op failed:", err);
    } finally {
      setBusy(false);
    }
  };

  const onEnable = () => {
    const path = repoPath();
    if (!path) return;
    void runOp(() => sparseInit(path, coneLocal()));
  };

  const onApply = () => {
    const path = repoPath();
    if (!path) return;
    void runOp(() =>
      sparseSetPatterns(path, coneLocal(), splitPatterns(patternsLocal())),
    );
  };

  const onReapply = () => {
    const path = repoPath();
    if (!path) return;
    void runOp(() => sparseReapply(path));
  };

  const onDisable = () => {
    const path = repoPath();
    if (!path) return;
    void runOp(() => sparseDisable(path));
  };

  const ready = () => repoPath() !== undefined && state() !== undefined;
  const isEnabled = () => state()?.enabled ?? false;

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Sparse checkout</h3>
      <p class="ui-panel__helper">
        Hide directories you don't need so the working tree only
        materialises a subset of the repo. Useful on large monorepos.
        Operations run through the <code>git</code> CLI — yryvu's
        backend doesn't reimplement <code>sparse-checkout</code>
        natively yet. Cone mode (recommended) restricts patterns to
        whole directories; pattern mode allows globs.
      </p>

      <Show
        when={repoPath() !== undefined}
        fallback={
          <p class="ui-panel__helper">
            Open a repository to configure sparse checkout.
          </p>
        }
      >
        <Suspense fallback={<p class="ui-panel__helper">Loading state…</p>}>
          <Show when={state() !== undefined}>
            <label class="notifications-panel__row">
              <input
                type="checkbox"
                class="notifications-panel__toggle"
                checked={coneLocal()}
                disabled={!ready() || busy()}
                onChange={(e) => setConeLocal(e.currentTarget.checked)}
              />
              <span class="notifications-panel__label">
                <span class="notifications-panel__label-text">
                  Cone mode (recommended)
                </span>
                <span class="notifications-panel__hint">
                  Only directory paths — safer, faster, no glob
                  footguns. Disable for raw <code>gitignore</code>-style
                  pattern matching.
                </span>
              </span>
            </label>

            <div class="sparse-panel__field">
              <label
                class="ui-panel__label"
                for="sparse-checkout-patterns"
              >
                Patterns (one per line)
              </label>
              <textarea
                id="sparse-checkout-patterns"
                class="sparse-panel__textarea"
                rows={8}
                placeholder={"src/\ndocs/\n# Lines starting with # are ignored"}
                value={patternsLocal()}
                disabled={!ready() || busy()}
                onInput={(e) => setPatternsLocal(e.currentTarget.value)}
              />
            </div>

            <div class="ui-panel__actions sparse-panel__actions">
              <Show
                when={isEnabled()}
                fallback={
                  <button
                    type="button"
                    class="ui-panel__btn"
                    onClick={onEnable}
                    disabled={!ready() || busy()}
                  >
                    {busy() ? "Working…" : "Enable sparse checkout"}
                  </button>
                }
              >
                <button
                  type="button"
                  class="ui-panel__btn"
                  onClick={onApply}
                  disabled={!ready() || busy()}
                >
                  {busy() ? "Working…" : "Apply patterns"}
                </button>
                <button
                  type="button"
                  class="ui-panel__btn ui-panel__btn--secondary"
                  onClick={onReapply}
                  disabled={!ready() || busy()}
                >
                  Reapply
                </button>
                <button
                  type="button"
                  class="ui-panel__btn ui-panel__btn--secondary"
                  onClick={onDisable}
                  disabled={!ready() || busy()}
                >
                  Disable
                </button>
              </Show>
            </div>
          </Show>
        </Suspense>
      </Show>
    </div>
  );
}
