// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  addRemote,
  fetchPrune,
  removeRemote,
  renameRemote,
  setRemotePushUrl,
  setRemoteUrl,
} from "../../ipc";
import { fetchOutcome } from "../../ipc/fetchReport";
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
      const report = await fetchPrune(path);
      refresh();
      const outcome = fetchOutcome(report);
      // The dialog banner only speaks up when nothing was fetched — a
      // partial run already says so in its toast, and a red banner over
      // refs that did arrive overstates it.
      if (outcome.severity === "error") {
        setDialogError(`Refresh failed: ${outcome.message}`);
      }
      notify[outcome.severity](outcome.title, {
        ...(outcome.message ? { message: outcome.message } : {}),
        category: "remoteSync",
      });
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

  /// A push URL is applied as a second call because `add_remote` takes
  /// only the fetch URL — mirroring git, where `remote add` has no
  /// pushurl flag and `set-url --push` is a separate step.
  async function submitAddRemote(values: {
    name: string;
    fetchUrl: string;
    pushUrl: string;
  }) {
    const path = repoPath();
    if (!path) return;
    const d = dialog();
    if (d?.kind !== "add-remote") return;
    const { name } = values;
    const url = values.fetchUrl;
    if (!name || !url) {
      setDialogError("Name and URL are required");
      return;
    }
    try {
      await addRemote(path, name, url);
      if (values.pushUrl !== "") {
        await setRemotePushUrl(path, name, values.pushUrl);
      }
      closeDialog();
      refresh();
      notify.success(`Added remote ${name}`, { category: "repoObject" });
    } catch (err) {
      setDialogError(String(err));
    }
  }

  /// Applies only what actually changed, and renames first: every
  /// other write keys on the remote's name, so renaming last would
  /// address a remote that no longer exists under that name.
  ///
  /// An empty `pushUrl` clears `remote.<name>.pushurl` rather than
  /// pinning it to the fetch URL — see `setRemotePushUrl`. The clear is
  /// skipped when it was already unset so an unrelated edit doesn't
  /// write to config for nothing.
  async function submitEditRemote(values: {
    name: string;
    fetchUrl: string;
    pushUrl: string;
  }) {
    const path = repoPath();
    if (!path) return;
    const d = dialog();
    if (d?.kind !== "edit-remote") return;
    if (!values.name) {
      setDialogError("Name is required");
      return;
    }
    if (!values.fetchUrl) {
      setDialogError("Fetch URL is required");
      return;
    }

    const before = d.remote;
    const nextPushUrl = values.pushUrl === "" ? null : values.pushUrl;

    try {
      if (values.name !== before.name) {
        const staleRefspecs = await renameRemote(path, before.name, values.name);
        if (staleRefspecs.length > 0) {
          // The rename succeeded; these refspecs were hand-customised so
          // libgit2 left them naming the old remote. Silence would leave
          // the user with a remote that fetches nothing.
          notify.info("Custom refspecs left unchanged", {
            message: `${staleRefspecs.join(", ")} still reference '${before.name}'`,
            category: "repoObject",
          });
        }
      }
      if (values.fetchUrl !== (before.fetchUrl ?? "")) {
        await setRemoteUrl(path, values.name, values.fetchUrl);
      }
      if (nextPushUrl !== before.pushUrl) {
        await setRemotePushUrl(path, values.name, nextPushUrl);
      }
      closeDialog();
      refresh();
      notify.success(`Updated remote ${values.name}`, {
        category: "repoObject",
      });
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
