// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  pull,
  push,
  rebaseCurrentOnto,
  resetToCommit,
  setUpstream,
  type ResetMode,
} from "../../ipc";
import { refreshGraph, refreshWorkingTree, repoPath } from "../../state";
import { notify } from "../../components/Notifications";
import type { BranchOpsState } from "../state";

export interface RefHandlersDeps {
  state: BranchOpsState;
  refresh: () => void;
}

/**
 * Ref-moving handlers — every op here mutates HEAD or its upstream and
 * therefore must call `refreshGraph()` on top of `refresh()`. CommitGraph
 * subscribes only to `graphNonce`, not `branchesNonce`, so without the
 * extra bump the pills update but the lanes stay frozen (validated
 * 2026-04-30 during the #221 work).
 */
export function createRefHandlers(deps: RefHandlersDeps) {
  const { state, refresh } = deps;
  const { dialog, setDialog, setDialogError, dialogNameInput, mergeStrategy, closeDialog } = state;

  async function doRebaseCurrentOnto(target: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await rebaseCurrentOnto(path, target);
      // Rebase rewrites HEAD's history with new SHAs — graph must
      // restream so the new linear chain replaces the old one.
      refreshGraph();
      refresh();
      refreshWorkingTree();
      notify.success("Rebased", {
        message: `onto ${target}`,
        category: "branch",
      });
    } catch (err) {
      notify.error("Rebase failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  async function doPullCurrent() {
    const path = repoPath();
    if (!path) return;
    try {
      const result = await pull(path, mergeStrategy());
      // Pull may FF HEAD or write a merge commit; either way the graph
      // gains rows and HEAD pill jumps.
      refreshGraph();
      refresh();
      refreshWorkingTree();
      if (result.kind === "conflict") {
        setDialog({ kind: "merge-result", result });
      } else {
        notify.success("Pulled", { category: "remoteSync" });
      }
    } catch (err) {
      notify.error("Pull failed", {
        message: String(err),
        category: "remoteSync",
      });
    }
  }

  async function doPushCurrent() {
    const path = repoPath();
    if (!path) return;
    try {
      await push(path);
      // Push doesn't move HEAD, but the remote pill catches up to it;
      // refreshGraph so the remote-tracking ref renders at the new tip.
      refreshGraph();
      refresh();
      notify.success("Pushed", { category: "remoteSync" });
    } catch (err) {
      notify.error("Push failed", {
        message: String(err),
        category: "remoteSync",
      });
    }
  }

  async function doResetTo(sha: string, mode: ResetMode) {
    const path = repoPath();
    if (!path) return;
    try {
      await resetToCommit(path, sha, mode);
      // Reset moves HEAD (and pops commits) — graph must restream so
      // the HEAD pill lands on the target sha and the dropped commits
      // disappear (or stay, if any branch still tips them).
      refreshGraph();
      refresh();
      refreshWorkingTree();
      notify.success("Reset HEAD", {
        message: `${mode} → ${sha.slice(0, 7)}`,
        category: "branch",
      });
    } catch (err) {
      notify.error("Reset failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  async function submitSetUpstream() {
    const s = dialog();
    if (s?.kind !== "set-upstream") return;
    const path = repoPath();
    if (!path) return;
    const next = dialogNameInput().trim();
    const upstream = next.length > 0 ? next : null;
    try {
      await setUpstream(path, s.branchName, upstream);
      closeDialog();
      refresh();
      notify.success("Upstream updated", {
        message: upstream ?? "(cleared)",
        category: "branch",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Set upstream failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  return {
    doRebaseCurrentOnto,
    doPullCurrent,
    doPushCurrent,
    doResetTo,
    submitSetUpstream,
  };
}
