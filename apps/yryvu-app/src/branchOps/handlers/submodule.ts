// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  submoduleAdd,
  submoduleDeinit,
  submoduleRemove,
  submoduleReset,
} from "../../ipc";
import { refreshWorkingTree, repoPath } from "../../state";
import { notify } from "../../components/Notifications";
import type { BranchOpsState } from "../state";

export interface SubmoduleHandlersDeps {
  state: BranchOpsState;
  refresh: () => void;
}

/**
 * Submodule add / remove submitters. `submitSubmoduleAdd` reads two
 * fields off the dialog state (URL via dialogNameInput, target dir via
 * dialogPathInput) — the dialog component itself stays a stateless
 * wrapper.
 */
export function createSubmoduleHandlers(deps: SubmoduleHandlersDeps) {
  const { state, refresh } = deps;
  const {
    dialog,
    setDialogError,
    dialogNameInput,
    dialogPathInput,
    submoduleBranch,
    submoduleName,
    closeDialog,
  } = state;

  async function submitSubmoduleRemove() {
    const s = dialog();
    if (s?.kind !== "submodule-remove") return;
    const path = repoPath();
    if (!path) return;
    try {
      await submoduleRemove(path, s.name);
      closeDialog();
      refresh();
      refreshWorkingTree();
      notify.success("Submodule removed", {
        message: s.path,
        category: "repoObject",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Remove submodule failed", {
        message: String(err),
        category: "repoObject",
      });
    }
  }

  async function submitSubmoduleAdd() {
    const s = dialog();
    if (s?.kind !== "submodule-add") return;
    const path = repoPath();
    const url = dialogNameInput().trim();
    const target = dialogPathInput().trim();
    if (!path || !url || !target) return;
    const branch = submoduleBranch().trim();
    const name = submoduleName().trim();
    try {
      await submoduleAdd(
        path,
        url,
        target,
        branch.length > 0 ? branch : undefined,
        name.length > 0 ? name : undefined,
      );
      closeDialog();
      refresh();
      refreshWorkingTree();
      notify.success("Submodule added", {
        message: target,
        category: "repoObject",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Add submodule failed", {
        message: String(err),
        category: "repoObject",
      });
    }
  }

  async function submitSubmoduleReset() {
    const s = dialog();
    if (s?.kind !== "submodule-reset") return;
    const path = repoPath();
    if (!path) return;
    try {
      await submoduleReset(path, s.name);
      closeDialog();
      refresh();
      refreshWorkingTree();
      notify.success("Submodule reset", {
        message: s.name,
        category: "repoObject",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Reset submodule failed", {
        message: String(err),
        category: "repoObject",
      });
    }
  }

  async function submitSubmoduleDeinit() {
    const s = dialog();
    if (s?.kind !== "submodule-deinit") return;
    const path = repoPath();
    if (!path) return;
    try {
      await submoduleDeinit(path, s.name);
      closeDialog();
      refresh();
      refreshWorkingTree();
      notify.success("Submodule deinitialized", {
        message: s.name,
        category: "repoObject",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Deinitialize submodule failed", {
        message: String(err),
        category: "repoObject",
      });
    }
  }

  return {
    submitSubmoduleAdd,
    submitSubmoduleRemove,
    submitSubmoduleReset,
    submitSubmoduleDeinit,
  };
}
