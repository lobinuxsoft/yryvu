// SPDX-License-Identifier: AGPL-3.0-or-later

import { submoduleAdd, submoduleRemove } from "../../ipc";
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
      notify.success("Submodule removed", { message: s.path });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Remove submodule failed", { message: String(err) });
    }
  }

  async function submitSubmoduleAdd() {
    const s = dialog();
    if (s?.kind !== "submodule-add") return;
    const path = repoPath();
    const url = dialogNameInput().trim();
    const target = dialogPathInput().trim();
    if (!path || !url || !target) return;
    try {
      await submoduleAdd(path, url, target);
      closeDialog();
      refresh();
      refreshWorkingTree();
      notify.success("Submodule added", { message: target });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Add submodule failed", { message: String(err) });
    }
  }

  return { submitSubmoduleAdd, submitSubmoduleRemove };
}
