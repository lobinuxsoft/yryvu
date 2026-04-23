// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";

import {
  commitAndPush,
  createCommit,
  discardPaths,
  stageAll,
  stageFiles,
  unstageAll,
  unstageFiles,
  type CommitOptions,
} from "../../ipc";
import {
  amendEnabled,
  commitDescription,
  commitMessage,
  dirtyFileCount,
  inspectorMode,
  refreshBranches,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
  selectedCommit,
  setAmendEnabled,
  setCommitDescription,
  setCommitMessage,
  setInspectorMode,
  setSelectedCommit,
  skipHooksEnabled,
  workingTreeStatus,
} from "../../state";
import { CommitDetails } from "./CommitDetails";
import { CommitPanel } from "./CommitPanel";
import { DiscardDialog } from "./DiscardDialog";

export function RightPanel() {
  // Paths queued for destructive discard; rendered by <DiscardDialog/>.
  // `null` = no dialog open; empty array is never used.
  const [pendingDiscard, setPendingDiscard] = createSignal<string[] | null>(
    null,
  );

  // Leaving staging mode whenever the user picks a different commit keeps the
  // inspector in sync with the graph selection.
  createEffect(
    on(
      selectedCommit,
      (sha) => {
        if (sha) setInspectorMode("details");
      },
      { defer: true }
    )
  );

  // Auto-retreat to details when the working tree becomes clean and the
  // user isn't composing an amend. Without this, external `git reset` /
  // discard-all / successful commit-of-everything would leave the commit
  // panel visible with all-zero sections — which reads as "changes
  // exist" to the user. Amend keeps staging alive because the user is
  // mid-reword even with a clean index.
  createEffect(() => {
    if (
      inspectorMode() === "staging" &&
      dirtyFileCount() === 0 &&
      !amendEnabled()
    ) {
      setInspectorMode("details");
    }
  });

  // Refresh working-tree status whenever the window regains focus or becomes
  // visible — covers the common flow where the user edits files in an external
  // editor and alt-tabs back to Chajá.
  onMount(() => {
    const refresh = () => refreshWorkingTree();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    onCleanup(() => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    });
  });

  async function handleStage(paths: string[]) {
    const p = repoPath();
    if (!p || paths.length === 0) return;
    try {
      await stageFiles(p, paths);
    } catch (err) {
      console.error("stage_files failed", err);
    }
    refreshWorkingTree();
  }

  async function handleUnstage(paths: string[]) {
    const p = repoPath();
    if (!p || paths.length === 0) return;
    try {
      await unstageFiles(p, paths);
    } catch (err) {
      console.error("unstage_files failed", err);
    }
    refreshWorkingTree();
  }

  async function handleStageAll() {
    const p = repoPath();
    if (!p) return;
    try {
      await stageAll(p);
    } catch (err) {
      console.error("stage_all failed", err);
    }
    refreshWorkingTree();
  }

  async function handleUnstageAll() {
    const p = repoPath();
    if (!p) return;
    try {
      await unstageAll(p);
    } catch (err) {
      console.error("unstage_all failed", err);
    }
    refreshWorkingTree();
  }

  function handleDiscard(paths: string[]) {
    if (paths.length === 0) return;
    // Surface destructive confirmation through <DiscardDialog/>. WebKit2GTK
    // silently auto-accepts `window.confirm`, which would discard without
    // prompting — discovered the hard way during the first dev pass.
    setPendingDiscard(paths);
  }

  async function confirmDiscard() {
    const paths = pendingDiscard();
    const p = repoPath();
    setPendingDiscard(null);
    if (!p || !paths || paths.length === 0) return;
    try {
      await discardPaths(p, paths);
    } catch (err) {
      console.error("discard_paths failed", err);
    }
    refreshWorkingTree();
  }

  function pendingCommitOptions(): CommitOptions {
    return {
      summary: commitMessage(),
      description: commitDescription(),
      amend: amendEnabled(),
      skipHooks: skipHooksEnabled(),
    };
  }

  function clearPendingMessage() {
    setCommitMessage("");
    setCommitDescription("");
    setAmendEnabled(false);
  }

  async function handleCommit() {
    const p = repoPath();
    const opts = pendingCommitOptions();
    if (!p || !opts.summary.trim()) return;
    let newSha: string;
    try {
      newSha = await createCommit(p, opts);
    } catch (err) {
      console.error("create_commit failed", err);
      return;
    }
    clearPendingMessage();
    refreshWorkingTree();
    refreshGraph();
    refreshBranches();
    setSelectedCommit(newSha);
    setInspectorMode("details");
  }

  async function handleCommitAndPush() {
    const p = repoPath();
    const opts = pendingCommitOptions();
    if (!p || !opts.summary.trim()) return;
    let newSha: string;
    try {
      newSha = await commitAndPush(p, opts);
    } catch (err) {
      // The commit itself may have succeeded even if the push didn't —
      // tell the user so they can retry push alone instead of rewriting
      // their message.
      console.error("commit_and_push failed", err);
      alert(`Commit and Push failed:\n${String(err)}\n\nIf the commit went through, your working tree is already updated; you can retry the push separately.`);
      refreshWorkingTree();
      refreshGraph();
      refreshBranches();
      return;
    }
    clearPendingMessage();
    refreshWorkingTree();
    refreshGraph();
    refreshBranches();
    setSelectedCommit(newSha);
    setInspectorMode("details");
  }

  return (
    <aside class="inspector">
      <Show when={dirtyFileCount() > 0 && inspectorMode() === "details"}>
        <div class="inspector__banner">
          <span>
            {dirtyFileCount()} file change{dirtyFileCount() === 1 ? "" : "s"} in working directory
          </span>
          <button
            class="inspector__banner-action"
            type="button"
            onClick={() => setInspectorMode("staging")}
          >
            View Changes
          </button>
        </div>
      </Show>

      <div class="inspector__body">
        <Show when={inspectorMode() === "staging"}>
          <CommitPanel
            status={workingTreeStatus()}
            onStage={handleStage}
            onUnstage={handleUnstage}
            onDiscard={handleDiscard}
            onStageAll={handleStageAll}
            onUnstageAll={handleUnstageAll}
            onBack={() => setInspectorMode("details")}
            onCommit={handleCommit}
            onCommitAndPush={handleCommitAndPush}
          />
        </Show>

        <Show when={inspectorMode() === "details"}>
          <CommitDetails />
        </Show>
      </div>

      <DiscardDialog
        paths={pendingDiscard()}
        onConfirm={confirmDiscard}
        onCancel={() => setPendingDiscard(null)}
      />
    </aside>
  );
}
