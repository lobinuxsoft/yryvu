// SPDX-License-Identifier: AGPL-3.0-or-later

import { addRemote, fetchPrune, removeRemote, setRemoteUrl } from "../../ipc";
import { repoPath } from "../../state";
import { notify } from "../../components/Notifications";
import type { BranchOpsState } from "../state";

export interface RemoteHandlersDeps {
  state: BranchOpsState;
  refresh: () => void;
}

/**
 * Remote-side handlers: `refreshRemote` (fetch+prune) plus the
 * remote-management trio surfaced by the REMOTE-header context menu
 * (#227). The trio share the same close-dialog-on-success / keep-open-
 * on-error contract used by other dialog submitters.
 */
export function createRemoteHandlers(deps: RemoteHandlersDeps) {
  const { state, refresh } = deps;
  const {
    dialog,
    dialogNameInput,
    dialogPathInput,
    setDialogError,
    closeDialog,
    refreshingRemote,
    setRefreshingRemote,
  } = state;

  async function refreshRemote() {
    const path = repoPath();
    if (!path || refreshingRemote()) return;
    setRefreshingRemote(true);
    try {
      await fetchPrune(path);
      refresh();
      notify.success("Fetched all remotes", { category: "remoteSync" });
    } catch (err) {
      const msg = String(err);
      setDialogError(`Refresh failed: ${msg}`);
      notify.error("Fetch failed", { message: msg, category: "remoteSync" });
    } finally {
      setRefreshingRemote(false);
    }
  }

  /// Per-remote fetch with prune. Used both by the menu's silent
  /// `Fetch from <r>` action and as a building block for future
  /// per-remote refresh affordances.
  async function fetchRemote(remote: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await fetchPrune(path, remote);
      refresh();
      notify.success(`Fetched ${remote}`, { category: "remoteSync" });
    } catch (err) {
      notify.error(`Fetch ${remote} failed`, {
        message: String(err),
        category: "remoteSync",
      });
    }
  }

  async function submitAddRemote() {
    const path = repoPath();
    if (!path) return;
    const d = dialog();
    if (d?.kind !== "add-remote") return;
    const name = dialogNameInput().trim();
    const url = dialogPathInput().trim();
    if (!name || !url) {
      setDialogError("Name and URL are required");
      return;
    }
    try {
      await addRemote(path, name, url);
      closeDialog();
      refresh();
      notify.success(`Added remote ${name}`, { category: "repoObject" });
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function submitEditRemote() {
    const path = repoPath();
    if (!path) return;
    const d = dialog();
    if (d?.kind !== "edit-remote") return;
    const url = dialogNameInput().trim();
    if (!url) {
      setDialogError("URL is required");
      return;
    }
    try {
      await setRemoteUrl(path, d.name, url);
      closeDialog();
      refresh();
      notify.success(`Updated ${d.name} URL`, { category: "repoObject" });
    } catch (err) {
      setDialogError(String(err));
    }
  }

  async function submitRemoveRemote() {
    const path = repoPath();
    if (!path) return;
    const d = dialog();
    if (d?.kind !== "remove-remote") return;
    try {
      await removeRemote(path, d.name);
      closeDialog();
      refresh();
      notify.success(`Removed remote ${d.name}`, { category: "repoObject" });
    } catch (err) {
      setDialogError(String(err));
    }
  }

  return {
    refreshRemote,
    fetchRemote,
    submitAddRemote,
    submitEditRemote,
    submitRemoveRemote,
  };
}
