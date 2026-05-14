// SPDX-License-Identifier: AGPL-3.0-or-later

import { abortMerge, deleteRemoteBranch, mergeBranch } from "../../ipc";
import { refreshWorkingTree, repoPath } from "../../state";
import { notify } from "../../components/Notifications";
import type { BranchOpsState } from "../state";

export interface MergeHandlersDeps {
  state: BranchOpsState;
  refresh: () => void;
}

/**
 * Merge-family submitters: `submitMerge` runs the actual merge and
 * routes the result into the merge-result dialog (FF / merged /
 * conflict / already-up-to-date). `submitDeleteRemote` and
 * `doAbortMerge` are merge-adjacent flows with shared error/refresh
 * scaffolding.
 */
export function createMergeHandlers(deps: MergeHandlersDeps) {
  const { state, refresh } = deps;
  const { dialog, setDialog, setDialogError, mergeStrategy, closeDialog } =
    state;

  async function submitMerge() {
    const s = dialog();
    if (s?.kind !== "merge-pick") return;
    const path = repoPath();
    if (!path) return;
    try {
      const result = await mergeBranch(path, s.source, mergeStrategy());
      setDialog({ kind: "merge-result", result });
      refresh();
      refreshWorkingTree();
      switch (result.kind) {
        case "already-up-to-date":
          notify.success("Merge: already up to date", {
            message: s.source,
            category: "branch",
          });
          break;
        case "fast-forward":
          notify.success("Fast-forward merge", {
            message: `${s.source} → ${result.new_head.slice(0, 7)}`,
            category: "branch",
          });
          break;
        case "merged":
          notify.success("Merge commit", {
            message: `${s.source} → ${result.new_head.slice(0, 7)}`,
            category: "branch",
          });
          break;
        case "conflict":
          notify.error("Merge conflicts", {
            message: result.paths.join(", "),
            category: "branch",
          });
          break;
      }
    } catch (err) {
      setDialogError(String(err));
      notify.error("Merge failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  async function submitDeleteRemote() {
    const s = dialog();
    if (s?.kind !== "delete-remote") return;
    const path = repoPath();
    if (!path) return;
    try {
      await deleteRemoteBranch(path, s.remote, s.name);
      closeDialog();
      refresh();
      notify.success("Remote branch deleted", {
        message: `${s.remote}/${s.name}`,
        category: "branch",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Delete remote branch failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  async function doAbortMerge() {
    const path = repoPath();
    if (!path) return;
    try {
      await abortMerge(path);
      closeDialog();
      refresh();
      refreshWorkingTree();
      notify.success("Merge aborted", { category: "branch" });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Abort merge failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  return { submitMerge, submitDeleteRemote, doAbortMerge };
}
