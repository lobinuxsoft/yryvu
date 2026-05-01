// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchPrune } from "../../ipc";
import { repoPath } from "../../state";
import { notify } from "../../components/Notifications";
import type { BranchOpsState } from "../state";

export interface RemoteHandlersDeps {
  state: BranchOpsState;
  refresh: () => void;
}

/**
 * Remote-side handlers. Today only `refreshRemote` (fetch + prune) lives
 * here; future remote-management ops (manage remotes, set tracking, …)
 * land in this file too.
 */
export function createRemoteHandlers(deps: RemoteHandlersDeps) {
  const { state, refresh } = deps;
  const { setDialogError, refreshingRemote, setRefreshingRemote } = state;

  async function refreshRemote() {
    const path = repoPath();
    if (!path || refreshingRemote()) return;
    setRefreshingRemote(true);
    try {
      await fetchPrune(path);
      refresh();
      notify.success("Fetched all remotes");
    } catch (err) {
      const msg = String(err);
      setDialogError(`Refresh failed: ${msg}`);
      notify.error("Fetch failed", { message: msg });
    } finally {
      setRefreshingRemote(false);
    }
  }

  return { refreshRemote };
}
