// SPDX-License-Identifier: AGPL-3.0-or-later

import { createBranch, deleteLocalBranch, renameBranch } from "../../ipc";
import { repoPath } from "../../state";
import { notify } from "../../components/Notifications";
import type { BranchOpsState } from "../state";

export interface BranchHandlersDeps {
  state: BranchOpsState;
  refresh: () => void;
}

/**
 * Branch CRUD submitters. `submitDelete` has the only branching
 * behavior: a non-merged branch flips the dialog into "force?" mode
 * instead of toasting.
 */
export function createBranchHandlers(deps: BranchHandlersDeps) {
  const { state, refresh } = deps;
  const { dialog, setDialog, setDialogError, dialogNameInput, closeDialog } =
    state;

  async function submitCreate() {
    const s = dialog();
    if (s?.kind !== "create") return;
    const path = repoPath();
    const name = dialogNameInput().trim();
    if (!path || !name) return;
    try {
      await createBranch(path, name, s.from);
      closeDialog();
      refresh();
      notify.success("Branch created", { message: name, category: "branch" });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Create branch failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  async function submitRename() {
    const s = dialog();
    if (s?.kind !== "rename") return;
    const path = repoPath();
    const newName = dialogNameInput().trim();
    if (!path || !newName || newName === s.oldName) {
      closeDialog();
      return;
    }
    try {
      await renameBranch(path, s.oldName, newName);
      closeDialog();
      refresh();
      notify.success("Branch renamed", {
        message: `${s.oldName} → ${newName}`,
        category: "branch",
      });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Rename branch failed", {
        message: String(err),
        category: "branch",
      });
    }
  }

  async function submitDelete(force: boolean) {
    const s = dialog();
    if (s?.kind !== "delete") return;
    const path = repoPath();
    if (!path) return;
    try {
      await deleteLocalBranch(path, s.name, force);
      closeDialog();
      refresh();
      notify.success("Branch deleted", {
        message: force ? `${s.name} (forced)` : s.name,
        category: "branch",
      });
    } catch (err) {
      const msg = String(err);
      if (!force && msg.includes("not fully merged")) {
        // Keep the dialog open so the user can confirm a force-delete.
        // Don't toast yet — the dialog itself surfaces the next step.
        setDialog({ kind: "delete", name: s.name, unmerged: true });
        setDialogError(null);
        return;
      }
      setDialogError(msg);
      notify.error("Delete branch failed", { message: msg, category: "branch" });
    }
  }

  return { submitCreate, submitRename, submitDelete };
}
