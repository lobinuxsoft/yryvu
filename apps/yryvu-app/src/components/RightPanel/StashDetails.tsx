// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Right-panel stash inspector (issue #173). Mounted in place of
 * `CommitDetails` when the active single-selection sha resolves to a
 * stash entry via `stashByCommitSha`.
 *
 * Layout mirrors the commit inspector — Header → Message → Actions →
 * FileList — but tuned to stash semantics: the SHA pill carries the
 * `stash@{N}` index, the actions are Apply / Pop / Drop (no
 * branch/tag/cherry-pick verbs), and the file diff is computed against
 * the stash's HEAD-at-stash-time parent via `stashDiff`. The FileList
 * widget is reused unchanged with `revKey = "stash:N"` so the
 * ephemeral file-tree state lives in its own keyspace.
 */

import { createMemo, createResource, Show } from "solid-js";

import { FileList } from "../FileList";
import {
  stashApply,
  stashDiff,
  stashDrop,
  stashPopAt,
  type CommitDiff,
} from "../../ipc";
import {
  openDiffTab,
  refreshBranches,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
  selectedDiffFile,
  stashByCommitSha,
} from "../../state";
import { notify } from "../Notifications";

interface Props {
  sha: string;
}

export function StashDetails(props: Props) {
  const hit = createMemo(() => stashByCommitSha().get(props.sha));
  const label = createMemo(() => {
    const h = hit();
    if (!h) return props.sha.slice(0, 7);
    const subject = h.info.message.split("\n")[0] || `stash@{${h.index}}`;
    return subject;
  });

  const diffRequest = createMemo<[string, number] | undefined>(() => {
    const p = repoPath();
    const h = hit();
    if (!p || !h) return undefined;
    return [p, h.index];
  });
  const [diff] = createResource<CommitDiff | undefined, [string, number]>(
    diffRequest,
    async ([p, i]) => await stashDiff(p, i),
  );

  const revKey = createMemo(() => {
    const h = hit();
    return h ? `stash:${h.index}` : `stash:?:${props.sha}`;
  });

  const activeFilePath = createMemo<string | undefined>(() => {
    const sel = selectedDiffFile();
    if (!sel || sel.kind !== "commit" || sel.sha !== props.sha) return undefined;
    return sel.path;
  });

  function refreshAfterStashOp() {
    refreshWorkingTree();
    refreshBranches();
    refreshGraph();
  }

  async function apply() {
    const h = hit();
    const p = repoPath();
    if (!h || !p) return;
    try {
      await stashApply(p, h.index);
      refreshAfterStashOp();
      notify.success("Stash applied", { message: label(), category: "stash" });
    } catch (err) {
      notify.error("Apply failed", { message: String(err), category: "stash" });
    }
  }

  async function pop() {
    const h = hit();
    const p = repoPath();
    if (!h || !p) return;
    try {
      await stashPopAt(p, h.index);
      refreshAfterStashOp();
      notify.success("Stash popped", { message: label(), category: "stash" });
    } catch (err) {
      notify.error("Pop failed", { message: String(err), category: "stash" });
    }
  }

  function drop() {
    const h = hit();
    const p = repoPath();
    if (!h || !p) return;
    const ok = window.confirm(
      `Drop ${label()}?\n\n` +
        `This removes the stash from the queue. The stash sha stays in ` +
        `the git objects database until garbage collection (~90 days), ` +
        `so you can recover it from a terminal — but it's gone from ` +
        `yryvu's UI.`,
    );
    if (!ok) return;
    void (async () => {
      try {
        await stashDrop(p, h.index);
        refreshAfterStashOp();
        notify.info("Stash dropped", { message: label(), category: "stash" });
      } catch (err) {
        notify.error("Drop failed", { message: String(err), category: "stash" });
      }
    })();
  }

  return (
    <Show
      when={hit()}
      fallback={<p class="inspector__empty">Stash entry not available.</p>}
    >
      {(h) => (
        <>
          <header class="inspector__header">
            <h2 class="inspector__title">
              <span class="inspector__stash-index">stash@{`{${h().index}}`}</span>
              <code class="inspector__sha">{props.sha.slice(0, 7)}</code>
            </h2>
            <Show when={h().info.branch_name}>
              <p class="inspector__subtitle">
                On <code>{h().info.branch_name}</code>
              </p>
            </Show>
            <p class="inspector__subtitle">
              {new Date(h().info.when * 1000).toLocaleString()}
            </p>
          </header>

          <div class="inspector__block">
            <p class="inspector__message">{label()}</p>
          </div>

          <div class="inspector__stash-actions">
            <button
              type="button"
              class="dialog__btn dialog__btn--primary"
              onClick={() => void apply()}
            >
              Apply
            </button>
            <button
              type="button"
              class="dialog__btn"
              onClick={() => void pop()}
            >
              Pop
            </button>
            <button
              type="button"
              class="dialog__btn dialog__btn--danger"
              onClick={drop}
            >
              Drop…
            </button>
          </div>

          <Show when={diff.error}>
            <div class="inspector__error">{String(diff.error)}</div>
          </Show>
          <FileList
            repoId={repoPath() ?? ""}
            revKey={revKey()}
            listType="committed"
            files={diff()?.files ?? []}
            activeFilePath={activeFilePath()}
            onSelectFile={(path) => openDiffTab(props.sha, path)}
            loading={diff.loading}
          />
        </>
      )}
    </Show>
  );
}
