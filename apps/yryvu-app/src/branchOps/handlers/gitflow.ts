// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  gitflowFeatureFinish,
  gitflowFeatureStart,
  gitflowHotfixFinish,
  gitflowHotfixStart,
  gitflowReleaseFinish,
  gitflowReleaseStart,
  githubFlowFinish,
  githubFlowStart,
  type GitflowFinishOutcome,
} from "../../ipc";
import {
  refreshBranches,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
} from "../../state";
import { notify } from "../../components/Notifications";
import { stripPrefix } from "../menus/gitflow";
import type { BranchOpsState } from "../state";

export interface GitflowHandlersDeps {
  state: BranchOpsState;
  refresh: () => void;
}

/// Gitflow ops move HEAD, create merge commits / tags, and delete
/// branches — every refresh source is affected, so refresh all three
/// nonces (the graph subscribes to graphNonce only, see the refresh
/// pattern note in project memory).
function refreshAll() {
  refreshGraph();
  refreshBranches();
  refreshWorkingTree();
}

/**
 * Git Flow + GitHub Flow start/finish submitters (issue #19). Start ops
 * create + check out a topic branch; finish ops run no-ff merges back
 * and may halt on conflict (FinishOutcome::conflict) leaving the repo
 * merge-in-progress for the StateBanner to surface.
 */
export function createGitflowHandlers(deps: GitflowHandlersDeps) {
  const { state } = deps;
  const {
    dialog,
    closeDialog,
    setDialogError,
    gitflowName,
    gitflowTagMessage,
    gitflowKeepBranch,
    gitflowBase,
  } = state;

  async function submitGitflowStart() {
    const s = dialog();
    if (s?.kind !== "gitflow-start") return;
    const path = repoPath();
    const name = gitflowName().trim();
    if (!path || !name) return;
    try {
      let branch: string;
      switch (s.flow) {
        case "feature":
          branch = await gitflowFeatureStart(path, name);
          break;
        case "release":
          branch = await gitflowReleaseStart(path, name);
          break;
        case "hotfix":
          branch = await gitflowHotfixStart(path, name);
          break;
        case "github":
          branch = await githubFlowStart(path, gitflowBase().trim(), name);
          break;
      }
      closeDialog();
      refreshAll();
      notify.success("Branch started", { message: branch, category: "branch" });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Start failed", { message: String(err), category: "branch" });
    }
  }

  async function submitGitflowFinish() {
    const s = dialog();
    if (s?.kind !== "gitflow-finish") return;
    const path = repoPath();
    const name = gitflowName().trim();
    if (!path || !name) return;
    const tagMessage = gitflowTagMessage();
    const keep = gitflowKeepBranch();
    try {
      let outcome: GitflowFinishOutcome;
      switch (s.flow) {
        case "feature":
          outcome = await gitflowFeatureFinish(path, stripPrefix(name), keep);
          break;
        case "release":
          outcome = await gitflowReleaseFinish(
            path,
            stripPrefix(name),
            tagMessage,
            keep,
          );
          break;
        case "hotfix":
          outcome = await gitflowHotfixFinish(
            path,
            stripPrefix(name),
            tagMessage,
            keep,
          );
          break;
        case "github":
          outcome = await githubFlowFinish(path, gitflowBase().trim(), name, keep);
          break;
      }
      closeDialog();
      refreshAll();
      reportFinish(outcome);
    } catch (err) {
      setDialogError(String(err));
      notify.error("Finish failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  return { submitGitflowStart, submitGitflowFinish };
}

function reportFinish(outcome: GitflowFinishOutcome) {
  if (outcome.kind === "conflict") {
    notify.error("Finish halted on conflicts", {
      message: `${outcome.step}: ${outcome.paths.join(", ")}`,
      category: "branch",
    });
    return;
  }
  notify.success("Branch finished", {
    message: outcome.tag ? `tagged ${outcome.tag}` : undefined,
    category: "branch",
  });
}
