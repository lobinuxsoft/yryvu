// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cherry-pick onto… (issue #13). Opens from the commit context menu with
 * a single sha or the active multi-selection. Lets the user pick any
 * local branch as the target; the backend handles the optional switch
 * to that branch + replays each pick in array order.
 *
 * The local-branch list reuses `branchesNonce` so writes from other
 * paths (create-branch, checkout) refresh it implicitly. Remote-tracking
 * branches are filtered out — cherry-picking onto an `origin/foo` ref
 * would need a checkout-tracking dance the backend doesn't expose yet.
 */

import { createMemo, createResource, createSignal, For, Show } from "solid-js";

import type { BranchInfo } from "../../../ipc";
import { listBranches } from "../../../ipc";
import { branchesNonce, repoPath } from "../../../state";
import { Dialog } from "../../Dialog";

export interface CherryPickOntoState {
  shas: string[];
  shortShas: string[];
}

interface Props {
  state: CherryPickOntoState | undefined;
  error: string | null;
  onClose: () => void;
  onSubmit: (targetBranch: string) => void;
}

export function CherryPickOntoDialog(props: Props) {
  const [filter, setFilter] = createSignal("");
  const [picked, setPicked] = createSignal<string | null>(null);

  const [branches] = createResource<BranchInfo[], [string, number, boolean]>(
    () => [repoPath() ?? "", branchesNonce(), props.state !== undefined] as const,
    async ([path, , open]) => {
      if (!path || !open) return [] as BranchInfo[];
      return await listBranches(path);
    },
    { initialValue: [] },
  );

  const localBranches = createMemo<BranchInfo[]>(() =>
    branches().filter((b) => b.kind === "local"),
  );

  const currentBranch = createMemo<string | undefined>(
    () => localBranches().find((b) => b.is_head)?.name,
  );

  const filtered = createMemo<BranchInfo[]>(() => {
    const q = filter().trim().toLowerCase();
    const list = localBranches();
    if (!q) return list;
    return list.filter((b) => b.name.toLowerCase().includes(q));
  });

  const title = createMemo(() => {
    const n = props.state?.shas.length ?? 0;
    return n > 1 ? `Cherry-pick ${n} commits onto…` : "Cherry-pick onto…";
  });

  const handleClose = () => {
    setFilter("");
    setPicked(null);
    props.onClose();
  };

  const handleSubmit = () => {
    const target = picked();
    if (target) props.onSubmit(target);
  };

  return (
    <Dialog
      open={props.state !== undefined}
      title={title()}
      onClose={handleClose}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            disabled={!picked()}
            onClick={handleSubmit}
          >
            Cherry-pick
          </button>
        </>
      }
    >
      <Show when={props.state}>
        {(s) => (
          <>
            <p
              class="dialog__field"
              style={{ color: "var(--fg-2)", "font-size": "12px" }}
            >
              Source:{" "}
              <For each={s().shortShas}>
                {(sha, i) => (
                  <>
                    <code>{sha}</code>
                    <Show when={i() < s().shortShas.length - 1}>
                      <span>, </span>
                    </Show>
                  </>
                )}
              </For>
            </p>
          </>
        )}
      </Show>
      <div class="dialog__field" style={{ "margin-top": "8px" }}>
        <label for="cherry-pick-onto-filter">Target branch</label>
        <input
          id="cherry-pick-onto-filter"
          type="text"
          value={filter()}
          placeholder="Filter local branches…"
          onInput={(e) => setFilter(e.currentTarget.value)}
        />
      </div>
      <div class="cherry-pick-onto__list" role="listbox">
        <For
          each={filtered()}
          fallback={<p class="cherry-pick-onto__empty">No matching branches</p>}
        >
          {(b) => (
            <button
              type="button"
              role="option"
              class="cherry-pick-onto__item"
              classList={{
                "is-picked": picked() === b.name,
                "is-current": currentBranch() === b.name,
              }}
              aria-selected={picked() === b.name}
              onClick={() => setPicked(b.name)}
              onDblClick={() => {
                setPicked(b.name);
                handleSubmit();
              }}
            >
              <span class="cherry-pick-onto__name">{b.name}</span>
              <Show when={currentBranch() === b.name}>
                <span class="cherry-pick-onto__tag">current</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <Show when={props.error}>
        <p class="dialog__error">{props.error}</p>
      </Show>
    </Dialog>
  );
}
