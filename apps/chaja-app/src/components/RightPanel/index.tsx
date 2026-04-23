// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, on, onCleanup, onMount, Show } from "solid-js";

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

export function RightPanel() {
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

  async function handleDiscard(paths: string[]) {
    const p = repoPath();
    if (!p || paths.length === 0) return;
    // Destructive: confirm before calling backend. native confirm is
    // ugly but it's what we have until a proper dialog lands.
    const label =
      paths.length === 1
        ? `Discard changes to "${paths[0]}"?\n\nThis reverts the file to HEAD and cannot be undone.`
        : `Discard changes to ${paths.length} files?\n\nThis reverts them to HEAD and cannot be undone.`;
    if (!window.confirm(label)) return;
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
    </aside>
  );
}
