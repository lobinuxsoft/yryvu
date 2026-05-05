// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  annotateTag,
  deleteTag,
  deleteTagRemote,
  pushTag,
} from "../../ipc";
import { repoPath } from "../../state";
import { notify } from "../../components/Notifications";
import type { BranchOpsState } from "../state";

export interface TagHandlersDeps {
  state: BranchOpsState;
  refresh: () => void;
}

/**
 * Tag lifecycle ops behind the LeftPanel's TAG context menu (#223):
 *
 *   - `submitDeleteTag` — runs the local / per-remote / all-remotes
 *     delete depending on the dialog's `scope` discriminator. One
 *     submitter so the dialog only needs to know about its own state
 *     shape, not the IPC permutations.
 *   - `submitAnnotateTag` — converts a lightweight tag to annotated
 *     using the dialog's name input as the message.
 *   - `pushTagTo` — silent push to a single remote (called directly
 *     from the menu when there's no ambiguity to resolve via dialog).
 */
export function createTagHandlers(deps: TagHandlersDeps) {
  const { state, refresh } = deps;
  const { dialog, setDialogError, dialogNameInput, closeDialog } = state;

  async function submitDeleteTag() {
    const s = dialog();
    if (s?.kind !== "delete-tag") return;
    const path = repoPath();
    if (!path) return;
    try {
      switch (s.scope.type) {
        case "local":
          await deleteTag(path, s.name);
          break;
        case "remote":
          await deleteTagRemote(path, s.scope.remote, s.name);
          break;
        case "all-remotes":
          // Sequential — keeps a half-done state observable if a remote
          // refuses (typically auth issues). Bailing on the first error
          // is conservative; the user can retry the rest manually.
          for (const remote of s.scope.remotes) {
            await deleteTagRemote(path, remote, s.name);
          }
          break;
      }
      closeDialog();
      refresh();
      const msg = (() => {
        switch (s.scope.type) {
          case "local":
            return s.name;
          case "remote":
            return `${s.name} from ${s.scope.remote}`;
          case "all-remotes":
            return `${s.name} from ${s.scope.remotes.length} remote(s)`;
        }
      })();
      notify.success("Tag deleted", { message: msg });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Delete tag failed", { message: String(err) });
    }
  }

  async function submitAnnotateTag() {
    const s = dialog();
    if (s?.kind !== "annotate-tag") return;
    const path = repoPath();
    const message = dialogNameInput().trim();
    if (!path || !message) return;
    try {
      await annotateTag(path, s.name, message);
      closeDialog();
      refresh();
      notify.success("Tag annotated", { message: s.name });
    } catch (err) {
      setDialogError(String(err));
      notify.error("Annotate tag failed", { message: String(err) });
    }
  }

  async function pushTagTo(remote: string, name: string) {
    const path = repoPath();
    if (!path) return;
    try {
      await pushTag(path, remote, name);
      notify.success("Tag pushed", { message: `${name} → ${remote}` });
    } catch (err) {
      notify.error("Push tag failed", { message: String(err) });
    }
  }

  return { submitDeleteTag, submitAnnotateTag, pushTagTo };
}
