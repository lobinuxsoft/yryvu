// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, on, onCleanup, onMount, Show } from "solid-js";

import {
  amendCommit,
  commitStaged,
  stageFiles,
  unstageFiles,
} from "../../ipc";
import {
  amendEnabled,
  dirtyFileCount,
  fullCommitMessage,
  inspectorMode,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
  selectedCommit,
  setAmendEnabled,
  setCommitDescription,
  setCommitMessage,
  setInspectorMode,
  setSelectedCommit,
  workingTreeStatus,
} from "../../state";
import { CommitDetails } from "./CommitDetails";
import { StagingPanel } from "./StagingPanel";

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

  async function handleCommit() {
    const p = repoPath();
    const msg = fullCommitMessage();
    if (!p || !msg) return;
    const amend = amendEnabled();
    let newSha: string;
    try {
      newSha = amend ? await amendCommit(p, msg) : await commitStaged(p, msg);
      setCommitMessage("");
      setCommitDescription("");
      setAmendEnabled(false);
    } catch (err) {
      console.error(
        amend ? "amend_commit failed" : "commit_staged failed",
        err
      );
      return;
    }
    refreshWorkingTree();
    refreshGraph();
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
          <StagingPanel
            status={workingTreeStatus()}
            onStage={handleStage}
            onUnstage={handleUnstage}
            onBack={() => setInspectorMode("details")}
            onCommit={handleCommit}
          />
        </Show>

        <Show when={inspectorMode() === "details"}>
          <CommitDetails />
        </Show>
      </div>
    </aside>
  );
}
